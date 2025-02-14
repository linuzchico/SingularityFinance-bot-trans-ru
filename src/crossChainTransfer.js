const ethers = require('ethers');
const logger = require('./logger');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function crossChainTransferWithRetry(wallet, targetAddress, amount, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await crossChainTransfer(wallet, targetAddress, amount);
            return result;
        } catch (error) {
            if (attempt === maxRetries) {
                logger.error(`Все попытки не удались, последняя ошибка: ${error.message}`);
                throw error;
            }
            logger.warn(`Попытка ${attempt} не удалась, повтор через 5 секунд...`);
            await delay(5000);
        }
    }
}

async function crossChainTransfer(wallet, targetAddress, amount) {
    const amountWei = ethers.utils.parseEther(amount.toString());
    const provider = wallet.provider;
    const contractAddress = '0x4200000000000000000000000000000000000016';
    // Чтение WrappedSFI ABI
    const abi = JSON.parse(fs.readFileSync(path.join(__dirname, 'ABI', 'L2ToL1MessagePasserABI.json'), 'utf8'));
    const contract = new ethers.Contract(contractAddress, abi, wallet);
    const gasLimit = 200000;
    const data = '0x';

    try {
        const balance = await provider.getBalance(wallet.address);
        if (balance.lt(amountWei)) {
            throw new Error('Недостаточно средств');
        }

        logger.info('Инициирование кроссчейн перевода...');
        const tx = await contract.initiateWithdrawal(
            targetAddress,
            gasLimit,
            data,
            { value: amountWei }
        );

        logger.info('Транзакция отправлена, ожидание подтверждения...');
        const receipt = await tx.wait();
        logger.info(`Транзакция подтверждена! Хэш транзакции: ${receipt.transactionHash}`);

        // Разбор логов событий оставлен закомментированным

        return receipt.transactionHash;
    } catch (error) {
        logger.error('Кроссчейн перевод не удался:', error);
        throw error;
    }
}

module.exports = { crossChainTransferWithRetry };