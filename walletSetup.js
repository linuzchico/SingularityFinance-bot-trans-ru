// walletSetup.js
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

function readPrivateKeys() {
    const privateKeyPath = path.join(__dirname, 'config', 'private_key.list');
    try {
        const data = fs.readFileSync(privateKeyPath, 'utf8');
        return data.split('\n')
            .map(key => key.trim())  // Удаление пробелов в начале и конце каждой строки
            .filter(key => key !== '')  // Фильтрация пустых строк
            .map(key => {
                // Удаление всех пробелов, включая пробелы в середине строки
                key = key.replace(/\s/g, '');
                // Если ключ начинается с '0x', удалить его
                return key.startsWith('0x') ? key.slice(2) : key;
            });
    } catch (error) {
        console.error('Не удалось прочитать приватные ключи:', error);
        return [];
    }
}

function setupProviderAndWallet(privateKeyIndex = 0) {
    let provider;
    let privateKeys;

    try {
        provider = new ethers.providers.JsonRpcProvider('https://rpc-testnet.singularityfinance.ai');
        privateKeys = readPrivateKeys();
    } catch (e) {
        console.log(e);
    }

    if (privateKeys.length === 0) {
        throw new Error('Файл с приватными ключами пуст!');
    }

    if (privateKeyIndex >= privateKeys.length) {
        throw new Error(`Индекс выходит за пределы диапазона! Всего ключей: ${privateKeys.length}`);
    }

    const privateKey = privateKeys[privateKeyIndex];
    const wallet = new ethers.Wallet(privateKey, provider);
    return { provider, wallet, totalWallets: privateKeys.length };
}

module.exports = setupProviderAndWallet;