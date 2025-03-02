const dotenv = require('dotenv').config();
const { fork } = require('child_process');
const setupProviderAndWallet = require('./walletSetup');
const logger = require('./src/logger');

// Get configuration from environment variables, if not set, use default values
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_WALLETS) || 3;
const BATCH_DELAY = parseInt(process.env.BATCH_DELAY_MS) || 5000;
const WALLET_DELAY = parseInt(process.env.WALLET_DELAY_MS) || 5000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function printAuthorInfo() {
    logger.info('='.repeat(50));
    logger.info('SingularityFinance Automatic Tasks Script');
    logger.info('Author: Kuffal');
    logger.info('Twitter: https://x.com/kuffal_linuz');
    logger.warn('Warning: Please create a new wallet to use this script.');
    logger.warn('          The author is not responsible for any losses caused by using this script.');
    logger.info('='.repeat(50));
    logger.info('');
}

function runProcessForWallet(walletIndex) {
    return new Promise((resolve, reject) => {
        const child = fork('./walletProcess.js', [walletIndex.toString()]);

        child.on('message', (message) => {
            logger.info(`Process ${walletIndex}: ${message}`);
        });

        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Process ${walletIndex} ended with code ${code}`));
            }
        });
    });
}

async function runOneCycle(totalWallets) {
    logger.info(`Used configuration: maximum concurrent processes=${MAX_CONCURRENT}, delay between batches=${BATCH_DELAY}, delay between wallets=${WALLET_DELAY}`);
    
    // Process wallets in batches
    for (let i = 0; i < totalWallets; i += MAX_CONCURRENT) {
        const processes = [];
        const batchSize = Math.min(MAX_CONCURRENT, totalWallets - i);
        
        // Start processes for this batch of wallets
        for (let j = 0; j < batchSize; j++) {
            const walletIndex = i + j;
            processes.push(runProcessForWallet(walletIndex));
            
            // Add a short delay between starting each wallet
            if (j < batchSize - 1) {
                await sleep(WALLET_DELAY);
            }
        }

        try {
            // Wait for the batch of wallets to finish processing
            await Promise.all(processes);
            logger.info(`Batch ${Math.ceil(i / MAX_CONCURRENT) + 1} processing completed`);
        } catch (error) {
            logger.error(`Error in processing batch ${Math.ceil(i / MAX_CONCURRENT) + 1}:`, error);
        }
        
        // Add a delay between batches
        if (i + MAX_CONCURRENT < totalWallets) {
            await sleep(BATCH_DELAY);
        }
    }
    
    logger.info('All wallet tasks in this cycle are completed');
}

async function main() {
    printAuthorInfo();
    const { totalWallets } = setupProviderAndWallet(0);
    
    while (true) {
        logger.info('Starting a new task cycle');
        await runOneCycle(totalWallets);
        logger.info('Task cycle completed, sleeping for 24 hours');
        await sleep(24 * 60 * 60 * 1000); // Sleep for 24 hours
    }
}

main().catch(error => {
    logger.error('Program execution error:', error);
    process.exit(1);
});
