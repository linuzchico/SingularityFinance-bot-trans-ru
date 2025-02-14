const ethers = require('ethers');
const logger = require('./logger');
const path = require('path');
require('dotenv').config();
const erc20ABI = require('./ABI/ERC20.json');
const wrappedSFIABI = require('./ABI/WrappedSFI.json');
const pairABI = require('./ABI/Pair.json');

// Чтение ABI файла
const dexABI = require(path.join(__dirname, 'ABI', 'DEX.json'));

// Адрес контракта DEX Router
const DEX_CONTRACT_ADDRESS = '0xFEccff0ecf1cAa1669A71C5E00b51B48E4CBc6A1';
const WSFI_CONTRACT_ADDRESS = '0x6dC404EFd04B880B0Ab5a26eF461b63A12E3888D';  // Исправлен адрес с учетом контрольной суммы

// Вспомогательная функция: задержка
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Функция для повторения операции
async function retryOperation(operation, maxRetries = 15) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            if (attempt === maxRetries) {
                logger.error(`Все попытки завершились неудачей, последняя ошибка: ${error.message}`);
                throw error;
            }
            logger.warn(`Попытка ${attempt} не удалась, повтор через 5 секунд...`);
            await delay(5000);
        }
    }
}

// Обмен ETH на токен sfi на AIMM
async function swapExactETHForTokens(wallet, amountIn, slippagePercent, path, deadline) {
    return retryOperation(async () => {
        const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);
        
        // 1. Проверка баланса ETH
        const ethBalance = await wallet.provider.getBalance(wallet.address);
        const amountToSwap = ethers.utils.parseEther(amountIn.toString());
        if (ethBalance.lt(amountToSwap)) {
            throw new Error(`Недостаточно ETH, требуется ${amountIn} ETH, но доступно только ${ethers.utils.formatEther(ethBalance)} ETH`);
        }

        // 2. Получение ожидаемого количества токенов
        const amountsOut = await router.getAmountsOut(
            amountToSwap,
            path
        );
        
        if (!amountsOut || amountsOut.length < 2) {
            throw new Error('Не удалось получить ожидаемое количество для обмена');
        }
        
        const expectedAmount = amountsOut[1];
        logger.info(`Ожидаемое количество токенов: ${ethers.utils.formatEther(expectedAmount)}`);

        // 3. Расчет минимального принимаемого количества с учетом проскальзывания
        const amountOutMin = expectedAmount.mul(100 - slippagePercent).div(100);
        logger.info(`Установлено проскальзывание ${slippagePercent}%, минимальное принимаемое количество: ${ethers.utils.formatEther(amountOutMin)} токенов`);

        // 4. Выполнение обмена
        logger.info(`Обмен ${amountIn} ETH на токены...`);
        const tx = await router.swapExactETHForTokens(
            amountOutMin,
            path,
            wallet.address,
            deadline,
            { value: amountToSwap }
        );

        const receipt = await tx.wait();
        logger.info(`Обмен завершен, хэш транзакции: ${receipt.transactionHash}`);
        
        // Получение баланса токенов после транзакции
        const targetTokenContract = new ethers.Contract(path[1], erc20ABI, wallet);
        const balance = await targetTokenContract.balanceOf(wallet.address);
        logger.info(`Текущий баланс токенов: ${ethers.utils.formatEther(balance)}`);
        
        return receipt.transactionHash;
    });
}

// Обмен токена на ETH
async function swapExactTokensForETH(wallet, amountIn, slippagePercent, path, deadline) {
    return retryOperation(async () => {
        const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);
        
        // 1. Проверка баланса
        const isWSFI = path[0].toLowerCase() === WSFI_CONTRACT_ADDRESS.toLowerCase();
        const tokenContract = new ethers.Contract(path[0], isWSFI ? wrappedSFIABI : erc20ABI, wallet);
        const tokenBalance = await tokenContract.balanceOf(wallet.address);
        const amountToSwap = ethers.utils.parseEther(amountIn.toString());
        if (tokenBalance.lt(amountToSwap)) {
            throw new Error(`Недостаточно токенов, требуется ${amountIn} токенов, но доступно только ${ethers.utils.formatEther(tokenBalance)}`);
        }
        
        // 2. Проверка и выполнение авторизации
        logger.info("Проверка статуса авторизации...");
        const allowance = await tokenContract.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
        
        if (allowance.lt(amountToSwap)) {
            logger.info("Авторизация контракта DEX...");
            const approveTx = await tokenContract.approve(
                DEX_CONTRACT_ADDRESS,
                ethers.constants.MaxUint256  // Авторизация на максимальное значение, чтобы избежать повторной авторизации
            );
            await approveTx.wait();
            logger.info("Авторизация успешна");
        } else {
            logger.info("Авторизация уже выполнена");
        }

        // 3. Получение ожидаемого количества ETH
        const amountsOut = await router.getAmountsOut(
            ethers.utils.parseEther(amountIn.toString()), 
            path
        );
        
        if (!amountsOut || amountsOut.length < 2) {
            throw new Error('Не удалось получить ожидаемое количество для обмена');
        }
        
        const expectedAmount = amountsOut[1];
        logger.info(`Ожидаемое количество ETH: ${ethers.utils.formatEther(expectedAmount)}`);

        // 4. Расчет минимального принимаемого количества с учетом проскальзывания
        const amountOutMin = expectedAmount.mul(100 - slippagePercent).div(100);
        logger.info(`Установлено проскальзывание ${slippagePercent}%, минимальное принимаемое количество: ${ethers.utils.formatEther(amountOutMin)} ETH`);

        // 5. Выполнение обмена
        const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            ethers.utils.parseEther(amountIn.toString()),
            amountOutMin,
            path,
            wallet.address,
            deadline
        );

        const receipt = await tx.wait();
        logger.info(`Обмен завершен, хэш транзакции: ${receipt.transactionHash}`);
        
        // Получение баланса ETH после транзакции
        const ethBalance = await wallet.provider.getBalance(wallet.address);
        logger.info(`Текущий баланс ETH: ${ethers.utils.formatEther(ethBalance)}`);
        
        return receipt.transactionHash;
    });
}

// Обмен токена на токен WSFI на AIMM (с учетом проскальзывания)
async function swapExactTokensForTokens(wallet, amountIn, slippagePercent, path, deadline) {
    return retryOperation(async () => {
        const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);
        
        // 1. Проверка баланса
        const isWSFI = path[0].toLowerCase() === WSFI_CONTRACT_ADDRESS.toLowerCase();
        const tokenContract = new ethers.Contract(path[0], isWSFI ? wrappedSFIABI : erc20ABI, wallet);
        const tokenBalance = await tokenContract.balanceOf(wallet.address);
        const amountToSwap = ethers.utils.parseEther(amountIn.toString());
        if (tokenBalance.lt(amountToSwap)) {
            throw new Error(`Недостаточно токенов, требуется ${amountIn}, но доступно только ${ethers.utils.formatEther(tokenBalance)}`);
        }
        
        // 2. Проверка и выполнение авторизации
        logger.info("Проверка статуса авторизации...");
        const allowance = await tokenContract.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
        
        if (allowance.lt(amountToSwap)) {
            logger.info("Авторизация контракта DEX...");
            const approveTx = await tokenContract.approve(
                DEX_CONTRACT_ADDRESS,
                ethers.constants.MaxUint256
            );
            await approveTx.wait();
            logger.info("Авторизация успешна");
        } else {
            logger.info("Авторизация уже выполнена");
        }

        // 3. Получение ожидаемого количества токенов
        const amountsOut = await router.getAmountsOut(
            amountToSwap,
            path
        );
        
        if (!amountsOut || amountsOut.length < 2) {
            throw new Error('Не удалось получить ожидаемое количество для обмена');
        }
        
        const expectedAmount = amountsOut[1];
        logger.info(`Ожидаемое количество токенов: ${ethers.utils.formatEther(expectedAmount)}`);

        // 4. Расчет минимального принимаемого количества с учетом проскальзывания
        const amountOutMin = expectedAmount.mul(100 - slippagePercent).div(100);
        logger.info(`Установлено проскальзывание ${slippagePercent}%, минимальное принимаемое количество: ${ethers.utils.formatEther(amountOutMin)} токенов`);

        // 5. Выполнение обмена
        const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amountToSwap,
            amountOutMin,
            path,
            wallet.address,
            deadline
        );

        logger.info('Ожидание подтверждения транзакции...');
        const receipt = await tx.wait();
        logger.info(`Обмен завершен, хэш транзакции: ${receipt.transactionHash}`);
        
        // Ожидание обновления состояния блокчейна
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Получение баланса токенов после транзакции
        try {
            const targetTokenContract = new ethers.Contract(path[1], erc20ABI, wallet);
            const balance = await targetTokenContract.balanceOf(wallet.address);
            logger.info(`Текущий баланс токенов: ${ethers.utils.formatEther(balance)}`);
        } catch (error) {
            logger.warn('Не удалось получить баланс токенов, но транзакция завершена', error.message);
        }
        
        return tx;
    });
}

// Добавление ликвидности (Токен + Токен) WSFI и AIMM
async function addLiquidity(wallet, tokenA, tokenB, amountA, amountB, slippagePercent, deadline) {
    return retryOperation(async () => {
        const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);
        
        // 1. Проверка баланса и авторизации токенов
        const tokenAContract = new ethers.Contract(tokenA, erc20ABI, wallet);
        const tokenBContract = new ethers.Contract(tokenB, erc20ABI, wallet);
        
        const amountADesired = ethers.utils.parseEther(amountA.toString());
        const amountBDesired = ethers.utils.parseEther(amountB.toString());
        
        // Проверка баланса
        const balanceA = await tokenAContract.balanceOf(wallet.address);
        const balanceB = await tokenBContract.balanceOf(wallet.address);
        
        if (balanceA.lt(amountADesired)) {
            throw new Error(`Недостаточно токенов A, требуется ${amountA} токенов, но доступно только ${ethers.utils.formatEther(balanceA)}`);
        }
        if (balanceB.lt(amountBDesired)) {
            throw new Error(`Недостаточно токенов B, требуется ${amountB} токенов, но доступно только ${ethers.utils.formatEther(balanceB)}`);
        }
        
        // Проверка авторизации
        const allowanceA = await tokenAContract.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
        const allowanceB = await tokenBContract.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
        
        if (allowanceA.lt(amountADesired)) {
            logger.info("Авторизация токена A...");
            const approveTxA = await tokenAContract.approve(DEX_CONTRACT_ADDRESS, ethers.constants.MaxUint256);
            await approveTxA.wait();
            logger.info("Авторизация токена A успешна");
        }
        
        if (allowanceB.lt(amountBDesired)) {
            logger.info("Авторизация токена B...");
            const approveTxB = await tokenBContract.approve(DEX_CONTRACT_ADDRESS, ethers.constants.MaxUint256);
            await approveTxB.wait();
            logger.info("Авторизация токена B успешна");
        }

        // 2. Расчет минимального принимаемого количества с учетом проскальзывания
        const amountAMin = amountADesired.mul(100 - slippagePercent).div(100);
        const amountBMin = amountBDesired.mul(100 - slippagePercent).div(100);

        logger.info(`Параметры добавления ликвидности:
            - Входной токен A: ${ethers.utils.formatEther(amountADesired)} WSFI
            - Входной токен B: ${ethers.utils.formatEther(amountBDesired)} AIMM
            - Проскальзывание: ${slippagePercent}%
            - Минимальное принимаемое количество A: ${ethers.utils.formatEther(amountAMin)} WSFI
            - Минимальное принимаемое количество B: ${ethers.utils.formatEther(amountBMin)} AIMM`);

        // 3. Добавление ликвидности
        const tx = await router.addLiquidity(
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            wallet.address,
            deadline
        );

        const receipt = await tx.wait();
        logger.info(`Ликвидность добавлена, хэш транзакции: ${receipt.transactionHash}`);
        
        // 4. Получение баланса LP токенов
        const pair = await router.factory().then(factory => 
            new ethers.Contract(factory, ['function getPair(address,address) view returns (address)'], wallet)
                .getPair(tokenA, tokenB)
        );
        
        if (pair) {
            const lpToken = new ethers.Contract(pair, erc20ABI, wallet);
            const lpBalance = await lpToken.balanceOf(wallet.address);
            logger.info(`Текущий баланс LP токенов: ${ethers.utils.formatEther(lpBalance)}`);
        }
        
        return receipt.transactionHash;
    });
}

// Добавление ликвидности (ETH + Токен)
async function addLiquidityETH(wallet, token, tokenAmount, ethAmount, slippagePercent, deadline) {
    return retryOperation(async () => {
        const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);
        
        // 1. Проверка баланса ETH и токенов
        const ethBalance = await wallet.provider.getBalance(wallet.address);
        const ethToAdd = ethers.utils.parseEther(ethAmount.toString());
        if (ethBalance.lt(ethToAdd)) {
            throw new Error(`Недостаточно ETH, требуется ${ethAmount} ETH, но доступно только ${ethers.utils.formatEther(ethBalance)} ETH`);
        }

        const tokenContract = new ethers.Contract(token, erc20ABI, wallet);
        const tokenToAdd = ethers.utils.parseEther(tokenAmount.toString());
        const tokenBalance = await tokenContract.balanceOf(wallet.address);
        if (tokenBalance.lt(tokenToAdd)) {
            throw new Error(`Недостаточно токенов, требуется ${tokenAmount} токенов, но доступно только ${ethers.utils.formatEther(tokenBalance)}`);
        }

        // 2. Проверка и выполнение авторизации
        const allowance = await tokenContract.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
        if (allowance.lt(tokenToAdd)) {
            logger.info("Авторизация токена...");
            const approveTx = await tokenContract.approve(DEX_CONTRACT_ADDRESS, ethers.constants.MaxUint256);
            await approveTx.wait();
            logger.info("Авторизация успешна");
        }

        // 3. Расчет минимального принимаемого количества с учетом проскальзывания
        const tokenAmountMin = tokenToAdd.mul(100 - slippagePercent).div(100);
        const ethAmountMin = ethToAdd.mul(100 - slippagePercent).div(100);

        logger.info(`Параметры добавления ликвидности:
            - Входной ETH: ${ethers.utils.formatEther(ethToAdd)} ETH
            - Входной токен: ${ethers.utils.formatEther(tokenToAdd)} токенов
            - Проскальзывание: ${slippagePercent}%
            - Минимальное принимаемое количество ETH: ${ethers.utils.formatEther(ethAmountMin)} ETH
            - Минимальное принимаемое количество токенов: ${ethers.utils.formatEther(tokenAmountMin)} токенов`);

        // 4. Добавление ликвидности
        const tx = await router.addLiquidityETH(
            token,
            tokenToAdd,
            tokenAmountMin,
            ethAmountMin,
            wallet.address,
            deadline,
            { value: ethToAdd }
        );

        const receipt = await tx.wait();
        logger.info(`Ликвидность добавлена, хэш транзакции: ${receipt.transactionHash}`);

        // 5. Получение баланса LP токенов
        const weth = await router.WETH();
        const pair = await router.factory().then(factory => 
            new ethers.Contract(factory, ['function getPair(address,address) view returns (address)'], wallet)
                .getPair(token, weth)
        );
        
        if (pair) {
            const lpToken = new ethers.Contract(pair, erc20ABI, wallet);
            const lpBalance = await lpToken.balanceOf(wallet.address);
            logger.info(`Текущий баланс LP токенов: ${ethers.utils.formatEther(lpBalance)}`);
        }

        return receipt.transactionHash;
    });
}

// Удаление ликвидности (Токен + Токен)
// tokenA - WSFI, tokenB - AIMM
// liquidity - количество ликвидности, рассчитывается на основе общего количества
// Добавление константы в начало DEX.js
const MAX_UINT256 = ethers.constants.MaxUint256;

// Изменение функции removeLiquidity, использование фиксированного deadline
async function removeLiquidity(wallet, tokenA, tokenB, liquidity, slippagePercent) { // Удален параметр deadline
    return retryOperation(async () => {
        const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);
        
        // 1. Получение адреса пары
        const factory = await router.factory();
        const factoryContract = new ethers.Contract(factory, ['function getPair(address,address) view returns (address)'], wallet);
        const pair = await factoryContract.getPair(tokenA, tokenB);
        
        if (!pair) {
            throw new Error('Пара не существует');
        }

        // 2. Получение резервов
        const pairContract = new ethers.Contract(pair, pairABI, wallet);
        const [token0, token1] = await Promise.all([
            pairContract.token0(),
            pairContract.token1()
        ]);
        const [reserve0, reserve1] = await pairContract.getReserves()
            .then(([r0, r1]) => token0.toLowerCase() === tokenA.toLowerCase() ? [r0, r1] : [r1, r0]);

        // 3. Расчет минимального принимаемого количества
        const totalSupply = await new ethers.Contract(pair, erc20ABI, wallet).totalSupply();
        
        // Расчет ожидаемого количества (пропорционально)
        const expectedAmountA = liquidity.mul(reserve0).div(totalSupply);
        const expectedAmountB = liquidity.mul(reserve1).div(totalSupply);
        
        // Применение проскальзывания
        const minAmountA = expectedAmountA.mul(100 - slippagePercent).div(100);
        const minAmountB = expectedAmountB.mul(100 - slippagePercent).div(100);
        
        logger.info(`Удаление ликвидности...`);
        logger.info(`Адрес LP токенов: ${pair}`);
        logger.info(`Количество LP: ${ethers.utils.formatEther(liquidity)}`);
        logger.info(`Проскальзывание: ${slippagePercent}%`);
        logger.info(`Ожидаемое количество:`);
        logger.info(`- TokenA (${tokenA}): ${ethers.utils.formatEther(expectedAmountA)}`);
        logger.info(`- TokenB (${tokenB}): ${ethers.utils.formatEther(expectedAmountB)}`);
        logger.info(`Минимальное принимаемое количество:`);
        logger.info(`- TokenA: ${ethers.utils.formatEther(minAmountA)}`);
        logger.info(`- TokenB: ${ethers.utils.formatEther(minAmountB)}`);

        try {
            const tx = await router.removeLiquidity(
                tokenA,
                tokenB,
                liquidity,           // Количество LP токенов
                minAmountA,         // Минимальное количество токена A
                minAmountB,         // Минимальное количество токена B
                wallet.address,
                ethers.constants.MaxUint256  // Использование фиксированного максимального значения для deadline
            );

            logger.info('Транзакция отправлена, ожидание подтверждения...');
            const receipt = await tx.wait();
            
            if (receipt.status === 0) {
                throw new Error('Транзакция не выполнена');
            }
            
            logger.info(`Ликвидность удалена! Хэш транзакции: ${receipt.transactionHash}`);
            return receipt.transactionHash;
        } catch (error) {
            // Попытка получить более подробную информацию об ошибке
            logger.error('Ошибка при удалении ликвидности:');
            logger.error(`- Адрес LP токенов: ${pair}`);
            logger.error(`- Количество LP: ${ethers.utils.formatEther(liquidity)}`);
            logger.error(`- Адрес токена A: ${tokenA}`);
            logger.error(`- Адрес токена B: ${tokenB}`);
            logger.error(`- Сообщение об ошибке: ${error.message}`);
            if (error.data) {
                logger.error(`- Данные ошибки: ${error.data}`);
            }
            throw error;
        }
    });
}

// Удаление ликвидности (ETH + Токен)
async function removeLiquidityETH(wallet, token, liquidity, amountTokenMin, amountETHMin, deadline) {
    return retryOperation(async () => {
        const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);
        
        logger.info(`Удаление ликвидности ETH...`);
        const tx = await router.removeLiquidityETHSupportingFeeOnTransferTokens(
            token,
            ethers.utils.parseEther(liquidity.toString()),
            ethers.utils.parseEther(amountTokenMin.toString()),
            ethers.utils.parseEther(amountETHMin.toString()),
            wallet.address,
            deadline
        );

        logger.info('Транзакция отправлена, ожидание подтверждения...');
        const receipt = await tx.wait();
        
        logger.info(`Ликвидность удалена! Хэш транзакции: ${receipt.transactionHash}`);
        return receipt.transactionHash;
    });
}

async function getTokenBalance(wallet, tokenAddress) {
    return retryOperation(async () => {
        const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, wallet);
        const balance = await tokenContract.balanceOf(wallet.address);
        
        logger.info(`Баланс токенов на адресе ${wallet.address}: ${ethers.utils.formatEther(balance)}`);
        return balance;
    });
}

// Получение количества токенов на выходе при обмене
async function getAmountsOut(wallet, amountIn, path) {
    return retryOperation(async () => {
        const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet.provider);
        const amounts = await router.getAmountsOut(
            ethers.utils.parseEther(amountIn.toString()),
            path
        );
        return amounts.map(amount => ethers.utils.formatEther(amount));
    });
}

// Получение адреса пары
async function getPair(wallet, tokenA, tokenB) {
    const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);
    const factory = await router.factory();
    const factoryContract = new ethers.Contract(factory, ['function getPair(address,address) view returns (address)'], wallet);
    const pair = await factoryContract.getPair(tokenA, tokenB);
    if (!pair) {
        throw new Error('Пара не существует');
    }
    return pair;
}

module.exports = {
    swapExactETHForTokens,
    swapExactTokensForETH,
    swapExactTokensForTokens,
    addLiquidity,
    addLiquidityETH,
    removeLiquidity,
    removeLiquidityETH,
    getTokenBalance,
    getAmountsOut,
    getPair,
    DEX_CONTRACT_ADDRESS
};