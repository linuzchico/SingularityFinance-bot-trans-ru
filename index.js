require('dotenv').config();
const { fork } = require('child_process');
const setupProviderAndWallet = require('./walletSetup');
const logger = require('./src/logger');

// Получить конфигурацию из переменных окружения, если не установлено, использовать значения по умолчанию
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_WALLETS) || 3;
const BATCH_DELAY = parseInt(process.env.BATCH_DELAY_MS) || 5000;
const WALLET_DELAY = parseInt(process.env.WALLET_DELAY_MS) || 5000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function printAuthorInfo() {
    logger.info('='.repeat(50));
    logger.info('Скрипт автоматических задач SingularityFinance');
    logger.info('Автор: 北月');
    logger.info('Твиттер: https://x.com/beiyue66');
    logger.warn('Внимание: Пожалуйста, создайте новый кошелек для использования этого скрипта.');
    logger.warn('          Автор не несет ответственности за любые убытки, вызванные использованием этого скрипта.');
    logger.info('='.repeat(50));
    logger.info('');
}

function runProcessForWallet(walletIndex) {
    return new Promise((resolve, reject) => {
        const child = fork('./walletProcess.js', [walletIndex.toString()]);

        child.on('message', (message) => {
            logger.info(`Процесс ${walletIndex}: ${message}`);
        });

        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Процесс ${walletIndex} завершился с кодом ${code}`));
            }
        });
    });
}

async function runOneCycle(totalWallets) {
    logger.info(`Используемая конфигурация: максимальное количество одновременных процессов=${MAX_CONCURRENT}, задержка между партиями=${BATCH_DELAY}мс, задержка между кошельками=${WALLET_DELAY}мс`);
    
    // Обработка кошельков партиями
    for (let i = 0; i < totalWallets; i += MAX_CONCURRENT) {
        const processes = [];
        const batchSize = Math.min(MAX_CONCURRENT, totalWallets - i);
        
        // Запуск процессов для этой партии кошельков
        for (let j = 0; j < batchSize; j++) {
            const walletIndex = i + j;
            processes.push(runProcessForWallet(walletIndex));
            
            // Добавить короткую задержку между запуском каждого кошелька
            if (j < batchSize - 1) {
                await sleep(WALLET_DELAY);
            }
        }

        try {
            // Ожидание завершения обработки этой партии кошельков
            await Promise.all(processes);
            logger.info(`Завершена обработка партии ${i/MAX_CONCURRENT + 1}`);
        } catch (error) {
            logger.error(`Ошибка в обработке партии ${i/MAX_CONCURRENT + 1}:`, error);
        }
        
        // Добавить задержку между партиями
        if (i + MAX_CONCURRENT < totalWallets) {
            await sleep(BATCH_DELAY);
        }
    }
    
    logger.info('Все задачи для кошельков в этом цикле выполнены');
}

async function main() {
    printAuthorInfo();
    const { totalWallets } = setupProviderAndWallet(0);
    
    while (true) {
        logger.info('Начало нового цикла задач');
        await runOneCycle(totalWallets);
        logger.info('Цикл задач завершен, спим 24 часа');
        await sleep(24 * 60 * 60 * 1000); // Спим 24 часа
    }
}

main().catch(error => {
    logger.error('Ошибка выполнения программы:', error);
    process.exit(1);
});