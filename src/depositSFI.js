const ethers = require('ethers');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Reading the ABI file
const wrappedSFIABI = require(path.join(__dirname, 'ABI', 'WrappedSFI.json'));
// WrappedSFI contract address
const contractAddress = '0x6dC404EFd04B880B0Ab5a26eF461b63A12E3888D';

// Helper function: delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Wrapper function for retry attempts
async function retryOperation(operation, maxRetries = 15) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
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

async function depositSFI(wallet, amount) {
    return retryOperation(async () => {
        const provider = wallet.provider;
        const contract = new ethers.Contract(contractAddress, wrappedSFIABI, wallet);
        const amountInWei = ethers.utils.parseEther(amount.toString());

        const balance = await provider.getBalance(wallet.address);
        if (balance.lt(amountInWei)) {
            throw new Error('Insufficient funds');
        }

        logger.info(`Exchanging SFI for ${amount} WSFI...`);
        const tx = await contract.deposit({ value: amountInWei });

        logger.info('Transaction sent, waiting for confirmation...');
        const receipt = await tx.wait();
        
        logger.info(`Exchange successful! Transaction hash: ${receipt.transactionHash}`);
        return receipt.transactionHash;
    });
}

async function getSFIBalance(wallet) {
    return retryOperation(async () => {
        const balance = await wallet.provider.getBalance(wallet.address);
        return ethers.utils.formatEther(balance);
    });
}

const WSFI_CONTRACT_ADDRESS = '0x6dC404EFd04B880B0Ab5a26eF461b63A12E3888D';
async function getWSFIBalance(wallet) {
    return retryOperation(async () => {
        const wsfiContract = new ethers.Contract(WSFI_CONTRACT_ADDRESS, wrappedSFIABI, wallet.provider);
        const balance = await wsfiContract.balanceOf(wallet.address);
        return ethers.utils.formatEther(balance);
    });
}

async function withdrawSFI(wallet, amount) {
    return retryOperation(async () => {
        const contract = new ethers.Contract(contractAddress, wrappedSFIABI, wallet);
        const amountInWei = ethers.utils.parseEther(amount.toString());

        const wSFIBalance = await contract.balanceOf(wallet.address);
        if (wSFIBalance.lt(amountInWei)) {
            throw new Error('Insufficient WSFI');
        }

        logger.info(`Exchanging WSFI for ${amount} SFI...`);
        const tx = await contract.withdraw(amountInWei);

        logger.info('Transaction sent, waiting for confirmation...');
        const receipt = await tx.wait();
        
        logger.info(`Exchange successful! Transaction hash: ${receipt.transactionHash}`);
        return receipt.transactionHash;
    });
}

module.exports = { depositSFI, withdrawSFI, getSFIBalance, getWSFIBalance };
