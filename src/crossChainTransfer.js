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
                logger.error(`All attempts failed, last error: ${error.message}`);
                throw error;
            }
            logger.warn(`Attempt ${attempt} failed, retrying in 5 seconds...`);
            await delay(5000);
        }
    }
}

async function crossChainTransfer(wallet, targetAddress, amount) {
    const amountWei = ethers.utils.parseEther(amount.toString());
    const provider = wallet.provider;
    const contractAddress = '0x4200000000000000000000000000000000000016';
    // Reading WrappedSFI ABI
    const abi = JSON.parse(fs.readFileSync(path.join(__dirname, 'ABI', 'L2ToL1MessagePasserABI.json'), 'utf8'));
    const contract = new ethers.Contract(contractAddress, abi, wallet);
    const gasLimit = 200000;
    const data = '0x';

    try {
        const balance = await provider.getBalance(wallet.address);
        if (balance.lt(amountWei)) {
            throw new Error('Insufficient funds');
        }

        logger.info('Initiating cross-chain transfer...');
        const tx = await contract.initiateWithdrawal(
            targetAddress,
            gasLimit,
            data,
            { value: amountWei }
        );

        logger.info('Transaction sent, waiting for confirmation...');
        const receipt = await tx.wait();
        logger.info(`Transaction confirmed! Transaction hash: ${receipt.transactionHash}`);

        // Parsing event logs left commented out

        return receipt.transactionHash;
    } catch (error) {
        logger.error('Cross-chain transfer failed:', error);
        throw error;
    }
}

module.exports = { crossChainTransferWithRetry };
