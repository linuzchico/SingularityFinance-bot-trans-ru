// walletProcess.js
const ethers = require('ethers');
const logger = require('./src/logger');
const erc20ABI = require('./src/ABI/ERC20.json');
const setupProviderAndWallet = require('./walletSetup');
const { stakeTokens, withdrawAndClaim, claim, getStakedAmount } = require('./src/staking');
const { claimFaucetWithRetry } = require('./src/faucet');
const { depositSFI, withdrawSFI, getSFIBalance, getWSFIBalance } = require('./src/depositSFI');
const { crossChainTransferWithRetry } = require('./src/crossChainTransfer');
const { 
    swapExactETHForTokens, 
    swapExactTokensForETH,
    swapExactTokensForTokens,
    addLiquidity,
    addLiquidityETH,
    removeLiquidity,
    removeLiquidityETH,
    getAmountsOut,
    getTokenBalance,
    getPair,
    DEX_CONTRACT_ADDRESS  
} = require('./src/DEX');

// Определение констант
const RATIOS = {
    // Распределение SFI
    SFI_TO_SWAP: 0.05,    // 8% SFI обмен на AIMM
    SFI_TO_WSFI: 0.92,    // 92% SFI конвертация в WSFI
    
    // Распределение WSFI
    WSFI_TO_SWAP: 0.05,   // 8% WSFI обмен на AIMM
    WSFI_TO_STAKE: 0.03,  // 5% одиночная ставка (всего 10%)
    WSFI_TO_LP: 0.09      // около 12% для LP
};

const WSFI_THRESHOLD = 4;  // Получение средств, если баланс WSFI ниже 4
const SFI_ADDRESS = "0x34Be5b8C30eE4fDe069DC878989686aBE9884470";
const WSFI_ADDRESS = "0x6dC404EFd04B880B0Ab5a26eF461b63A12E3888D";
const AIMM_ADDRESS = "0xAa4aFA7C07405992e3f6799dCC260D389687077a";
const LP_ADDRESS = "0xcc922d9E5DaB15513c6500B67459502A6C2e0F3C";

async function runWalletOperations(walletIndex) {
    const { wallet, provider } = setupProviderAndWallet(walletIndex);
    const address = wallet.address;

    try {
        logger.info(`Начало обработки кошелька ${walletIndex} (${address})`);

        // 1. Проверка баланса WSFI, получение средств, если баланс ниже порога
        const wsfiBalance = await getWSFIBalance(wallet);
        if (wsfiBalance < WSFI_THRESHOLD) {
            logger.info(`Текущий баланс WSFI (${wsfiBalance}) ниже ${WSFI_THRESHOLD}, получение средств`);
            const result = await claimFaucetWithRetry(address);
            switch(result.status) {
                case 'success':
                    logger.info('Успешное получение средств из крана', result.data);
                    break;
                case 'already_claimed':
                    logger.warn('Средства уже были получены из крана', result.message);
                    break;
                case 'failed':
                    logger.error('Не удалось получить средства из крана', result.message);
                    break;
                default:
                    logger.info('Неизвестный статус', result);
            }
            await new Promise(resolve => setTimeout(resolve, 10000));
        }

        // 2. Конвертация 92% SFI в WSFI
        const sfiBalance = await getSFIBalance(wallet);
        const sfiToConvert = sfiBalance * RATIOS.SFI_TO_WSFI;
        logger.info(`Конвертация ${sfiToConvert} SFI в WSFI`);
        await depositSFI(wallet, sfiToConvert);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 3. Обмен 8% SFI на AIMM
        const sfiToSwap = sfiBalance * RATIOS.SFI_TO_SWAP;
        logger.info(`Обмен ${sfiToSwap} SFI на AIMM`);
        try {
            await swapExactETHForTokens(
                wallet,
                sfiToSwap.toString(),
                30,
                [WSFI_ADDRESS, AIMM_ADDRESS],  
                ethers.constants.MaxUint256
            );
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Не удалось обменять SFI на AIMM:', error.message);
            throw error;
        }

        // 4. Обмен 8% WSFI на AIMM
        const currentWSFIBalance = await getWSFIBalance(wallet);
        const wsfiToSwap = currentWSFIBalance * RATIOS.WSFI_TO_SWAP;
        logger.info(`Обмен ${wsfiToSwap} WSFI на AIMM`);
        try {
            const swapTx2 = await swapExactTokensForTokens(
                wallet,
                wsfiToSwap.toString(),
                30,
                [WSFI_ADDRESS, AIMM_ADDRESS],
                "115792089237316195423570985008687907853269984665640564039457584007913129639935"
            );
            logger.info('Ожидание подтверждения транзакции обмена WSFI на AIMM...');
            await swapTx2.wait();
            logger.info('Транзакция обмена WSFI на AIMM подтверждена');
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Не удалось обменять WSFI на AIMM:', error.message);
            throw error;
        }

        // 5. Первая ставка 5% WSFI
        const wsfiToStake = currentWSFIBalance * RATIOS.WSFI_TO_STAKE;
        logger.info(`Первая ставка ${wsfiToStake} WSFI`);
        try {
            await stakeTokens(wallet, wsfiToStake);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Не удалось выполнить первую ставку:', error.message);
            throw error;
        }

        // 6. Первый Claim
        logger.info("Выполнение первого Claim");
        try {
            await claim(wallet);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Первый Claim не удался:', error.message);
            throw error;
        }

        // 7. Вторая ставка 5% WSFI
        logger.info(`Вторая ставка ${wsfiToStake} WSFI`);
        try {
            await stakeTokens(wallet, wsfiToStake);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Вторая ставка не удалась:', error.message);
            throw error;
        }

        // 8. Второй Claim
        logger.info("Выполнение второго Claim");
        try {
            await claim(wallet);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Второй Claim не удался:', error.message);
            throw error;
        }

        // 9. Создание LP
        try {
            // Получение балансов двух токенов
            const aimmBalance = await getTokenBalance(wallet, AIMM_ADDRESS);
            const wsfiBalance = await getTokenBalance(wallet, WSFI_ADDRESS);
            
            if (!aimmBalance || aimmBalance.isZero()) {
                throw new Error('Баланс AIMM равен 0, невозможно создать LP');
            }
            if (!wsfiBalance || wsfiBalance === 0) {
                throw new Error('Баланс WSFI равен 0, невозможно создать LP');
            }

            // Случайный выбор количества AIMM в диапазоне от 0.05 до 0.15
            const minAimm = 0.05;
            const maxAimm = 0.15;
            const random = Math.floor(Math.random() * 1000);
            let aimmToUse = minAimm + (maxAimm - minAimm) * random / 1000;

            // Убедиться, что не превышает 50% баланса (используя фактические значения)
            const aimmBalanceNumber = parseFloat(ethers.utils.formatUnits(aimmBalance, 18));
            if (aimmToUse > aimmBalanceNumber / 2) {
                aimmToUse = aimmBalanceNumber / 2;
            }

            // Расчет необходимого количества WSFI для пары (WSFI:AIMM = 1:0.7)
            let wsfiForLP = aimmToUse * 10 / 7;

            // Убедиться, что не превышает 50% баланса
            if (wsfiForLP > wsfiBalance / 2) {
                wsfiForLP = wsfiBalance / 2;
                // Пересчет количества AIMM
                aimmToUse = wsfiForLP * 7 / 10;
            }

            // Логирование с использованием 3 знаков после запятой
            logger.info(`Создание LP: использование ${wsfiForLP.toFixed(3)} WSFI и ${aimmToUse.toFixed(3)} AIMM`);

            // Прямой ввод чисел, функция addLiquidity внутри использует parseEther для преобразования в минимальные единицы
            await addLiquidity(
                wallet,
                WSFI_ADDRESS,
                AIMM_ADDRESS,
                wsfiForLP,
                aimmToUse,
                30,
                "115792089237316195423570985008687907853269984665640564039457584007913129639935"
            );
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Не удалось добавить ликвидность:', error.message);
            throw error;
        }

        // 10. Удаление ликвидности
        try {
            // Получение баланса LP
            const pair = await getPair(wallet, WSFI_ADDRESS, AIMM_ADDRESS);
            const lpToken = new ethers.Contract(pair, erc20ABI, wallet);
            const lpBalance = await lpToken.balanceOf(wallet.address);
            const lpBalanceFormatted = ethers.utils.formatEther(lpBalance);
            
            if (lpBalance.isZero()) {
                throw new Error('Баланс LP равен 0, невозможно удалить ликвидность');
            }

            // Проверка разрешения
            const allowance = await lpToken.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
            if (allowance.lt(lpBalance)) {
                logger.info("Авторизация токенов LP...");
                const approveTx = await lpToken.approve(DEX_CONTRACT_ADDRESS, ethers.constants.MaxUint256);
                const approveReceipt = await approveTx.wait();
                logger.info(`Авторизация токенов LP успешна, хэш транзакции: ${approveReceipt.transactionHash}`);
                
                // Повторная проверка успешности авторизации
                const newAllowance = await lpToken.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
                if (newAllowance.lt(lpBalance)) {
                    throw new Error('Не удалось авторизовать токены LP');
                }
            }
            
            // Случайный выбор процента для удаления из 25%, 50%, 75%, 100%
            const percentages = [25, 50, 75, 100];
            const selectedPercentage = percentages[Math.floor(Math.random() * percentages.length)];
            const lpToRemove = lpBalance.mul(selectedPercentage).div(100);
            logger.info(`Удаление ${selectedPercentage}% LP, количество: ${ethers.utils.formatEther(lpToRemove)}`);

            await removeLiquidity(
                wallet,
                WSFI_ADDRESS,
                AIMM_ADDRESS,
                lpToRemove,
                30  // Увеличение проскальзывания до 30% из-за высокой волатильности рынка
            );
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Не удалось удалить ликвидность:', error.message);
            throw error;
        }

        logger.info(`Операции с кошельком ${walletIndex} успешно завершены`);
        process.send(`Операции с кошельком ${walletIndex} успешно завершены`);

    } catch (error) {
        logger.error(`Операции с кошельком ${walletIndex} не удались:`, error);
        process.send(`Операции с кошельком ${walletIndex} не удались: ${error.message}`);
    }
}

const walletIndex = parseInt(process.argv[2], 10);
runWalletOperations(walletIndex).catch(error => {
    logger.error(`Операции с кошельком ${walletIndex} не удались:`, error);
    process.exit(1);
});