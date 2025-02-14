const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Чтение WrappedSFI ABI
const wrappedSFIABI = JSON.parse(fs.readFileSync(path.join(__dirname, 'ABI', 'WrappedSFI.json'), 'utf8'));

// Установка адресов контрактов
const STAKING_CONTRACT_ADDRESS = '0x22Dbdc9e8dd7C5E409B014BBcb53a3ef39736515';
const WRAPPED_SFI_ADDRESS = '0x6dC404EFd04B880B0Ab5a26eF461b63A12E3888D';

// Частичное определение ABI
const partialStakingABI = [
    {
        "inputs": [],
        "name": "claim",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "_amount",
                "type": "uint256"
            }
        ],
        "name": "withdrawAndClaim",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "_amount",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "_lockingPeriod",
                "type": "uint256"
            }
        ],
        "name": "deposit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            }
        ],
        "name": "userInfo",
        "outputs": [
            {
                "components": [
                    {
                        "internalType": "uint256",
                        "name": "amount",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "lockDate",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "unlockDate",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "score",
                        "type": "uint256"
                    }
                ],
                "internalType": "struct SDAOLockedStaking.UserInfo",
                "name": "",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

// Функция для повторных попыток
async function retry(operation, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            if (attempt === maxRetries) {
                logger.error(`Все попытки не удались, последняя ошибка: ${error.message}`);
                throw error;
            }
            logger.warn(`Попытка ${attempt} не удалась, повтор через 5 секунд...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Вычисление оптимального периода блокировки
function calculateOptimalLockingPeriod(unlockDate) {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const MAX_LOCKING_PERIOD = 360 * 24 * 60 * 60; // 360 дней в секундах

    if (unlockDate <= currentTimestamp) {
        // Если уже разблокировано, использовать максимальный период блокировки
        return MAX_LOCKING_PERIOD;
    } else {
        // Вычисление оставшегося времени блокировки
        const remainingLockTime = unlockDate - currentTimestamp;
        // Возвращение оставшегося времени блокировки, но не более максимального периода блокировки
        return Math.min(remainingLockTime, MAX_LOCKING_PERIOD);
    }
}

async function stakeTokens(wallet, amount) {
    return retry(async () => {
        const stakingContract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, partialStakingABI, wallet);
        const wrappedSFIContract = new ethers.Contract(WRAPPED_SFI_ADDRESS, wrappedSFIABI, wallet);
        const amountInWei = ethers.utils.parseEther(amount.toString());

        try {
            let optimalLockingPeriod;
            const userInfo = await stakingContract.userInfo(wallet.address);
            logger.info('Текущая информация о ставках пользователя:');
            logger.info(`- Количество ставок: ${ethers.utils.formatEther(userInfo.amount)} WSFI`);
            logger.info(`- Оценка ставок: ${userInfo.score.toString()}`);

            const hasExistingStake = userInfo.amount.gt(ethers.constants.Zero);

            if (hasExistingStake) {
                logger.info('Существуют ставки');
                optimalLockingPeriod = calculateOptimalLockingPeriod(userInfo.unlockDate.toNumber());
                logger.info(`Вычисленный оптимальный период блокировки (секунды): ${optimalLockingPeriod}`);
            } else {
                logger.info('Ставок не существует');
                optimalLockingPeriod = 7776000; // 90 дней
            }

            const wSFIBalance = await wrappedSFIContract.balanceOf(wallet.address);
            logger.info(`Баланс wSFI: ${ethers.utils.formatEther(wSFIBalance)} wSFI`);

            if (wSFIBalance.lt(amountInWei)) {
                throw new Error('Недостаточно средств wSFI');
            }

            logger.info('Одобрение использования токенов контрактом staking...');
            const approveTx = await wrappedSFIContract.approve(STAKING_CONTRACT_ADDRESS, amountInWei);
            await approveTx.wait();
            logger.info('Одобрение успешно');

            logger.info('Вызов контракта staking для ставки...');
            const depositTx = await stakingContract.deposit(amountInWei, optimalLockingPeriod, {
                gasLimit: 300000,
            });
            
            logger.info('Ожидание подтверждения транзакции...');
            const receipt = await depositTx.wait();
            
            if (receipt.status === 0) {
                throw new Error('Не удалось выполнить транзакцию');
            }
            
            logger.info('Ставка успешна!');

            logger.info('Ожидание 10 секунд для обновления ставки...');
            await new Promise(resolve => setTimeout(resolve, 10000));

            const updatedUserInfo = await stakingContract.userInfo(wallet.address);
            logger.info('Обновленная информация о ставках пользователя:');
            logger.info(`- Количество ставок: ${ethers.utils.formatEther(updatedUserInfo.amount)} SFI`);
            logger.info(`- Оценка ставок: ${updatedUserInfo.score.toString()}`);

            return receipt.transactionHash;
        } catch (error) {
            logger.error('Не удалось выполнить операцию ставки:', error);
            if (error.error && error.error.message) {
                logger.error('Детали ошибки:', error.error.message);
            }
            throw error;
        }
    });
}

async function getStakedAmount(wallet) {
    return retry(async () => {
        try {
            const stakingContract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, partialStakingABI, wallet.provider);
            const userInfo = await stakingContract.userInfo(wallet.address);
            
            const stakedAmount = ethers.utils.formatEther(userInfo.amount);
            
            logger.info(`Количество ставок пользователя ${wallet.address}: ${stakedAmount} WSFI`);
            
            return stakedAmount;
        } catch (error) {
            logger.error("Ошибка при получении количества ставок:", error);
            throw error;
        }
    });
}

async function withdrawAndClaim(wallet, amount) {
    return retry(async () => {
        const stakingContract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, partialStakingABI, wallet);
        const amountInWei = ethers.utils.parseEther(amount.toString());

        try {
            const userInfoBefore = await stakingContract.userInfo(wallet.address);
            logger.info('Информация о ставках пользователя перед выводом:');
            logger.info(`- Количество ставок: ${ethers.utils.formatEther(userInfoBefore.amount)} SFI`);
            logger.info(`- Оценка ставок: ${userInfoBefore.score.toString()}`);

            if (userInfoBefore.amount.lt(amountInWei)) {
                throw new Error('Недостаточно ставок для вывода указанного количества');
            }

            logger.info('Запрос на вывод количества:', amount, 'wSFI');

            logger.info('Вызов контракта staking для вывода и получения награды...');
            const withdrawTx = await stakingContract.withdrawAndClaim(amountInWei, {
                gasLimit: 300000,
            });
            
            logger.info('Ожидание подтверждения транзакции...');
            const receipt = await withdrawTx.wait();
            
            if (receipt.status === 0) {
                logger.error(`Транзакция не удалась. Хэш транзакции: ${receipt.transactionHash}`);
                throw new Error('Не удалось выполнить транзакцию');
            }
            
            logger.info('Вывод и получение награды успешны!');

            logger.info('Ожидание 10 секунд для обновления...');
            await new Promise(resolve => setTimeout(resolve, 10000));

            const userInfoAfter = await stakingContract.userInfo(wallet.address);
            logger.info('Информация о ставках пользователя после вывода:');
            logger.info(`- Количество ставок: ${ethers.utils.formatEther(userInfoAfter.amount)} WSFI`);
            logger.info(`- Оценка ставок: ${userInfoAfter.score.toString()}`);
            const actualWithdrawn = userInfoBefore.amount.sub(userInfoAfter.amount);
            logger.info(`Фактически выведенное количество: ${ethers.utils.formatEther(actualWithdrawn)} WSFI`);

            return receipt.transactionHash;
        } catch (error) {
            logger.error('Не удалось выполнить операцию вывода и получения награды:', error);
            if (error.error && error.error.message) {
                logger.error('Детали ошибки:', error.error.message);
            }
            throw error;
        }
    });
}

async function claim(wallet) {
    return retry(async () => {
        const stakingContract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, partialStakingABI, wallet);

        try {
            logger.info('Вызов контракта staking для получения награды...');
            const claimTx = await stakingContract.claim({
                gasLimit: 200000,
            });
            
            logger.info('Ожидание подтверждения транзакции...');
            const receipt = await claimTx.wait();
            
            if (receipt.status === 0) {
                logger.error(`Транзакция не удалась. Хэш транзакции: ${receipt.transactionHash}`);
                logger.error('Использованный газ:', receipt.gasUsed.toString());
                throw new Error('Не удалось выполнить транзакцию');
            }
            
            logger.info('Получение награды успешно!');

            const rewardEvent = receipt.logs.find(log => log.address === STAKING_CONTRACT_ADDRESS);
            if (rewardEvent) {
                const rewardAmount = ethers.utils.formatEther(rewardEvent.data);
                logger.info('Количество полученной награды:', rewardAmount, 'wSFI');
            } else {
                logger.error('Не удалось получить количество награды из логов транзакции.');
            }

            logger.info(`Хэш транзакции: ${receipt.transactionHash}`);

            return receipt.transactionHash;
        } catch (error) {
            logger.error('Не удалось выполнить операцию получения награды:', error);
            if (error.error && error.error.message) {
                logger.error('Детали ошибки:', error.error.message);
            }
            throw error;
        }
    });
}

module.exports = { stakeTokens, withdrawAndClaim, claim, getStakedAmount };