// walletSetup.js
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

function readPrivateKeys() {
    const privateKeyPath = path.join(__dirname, 'config', 'private_key.list');
    try {
        const data = fs.readFileSync(privateKeyPath, 'utf8');
        return data.split('\n')
            .map(key => key.trim())  // Remove spaces at the beginning and end of each line
            .filter(key => key !== '')  // Filter empty lines
            .map(key => {
                // Remove all spaces, including spaces in the middle of the line
                key = key.replace(/\s/g, '');
                // If the key starts with '0x', remove it
                return key.startsWith('0x') ? key.slice(2) : key;
            });
    } catch (error) {
        console.error('Failed to read private keys:', error);
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
        throw new Error('The private key file is empty!');
    }

    if (privateKeyIndex >= privateKeys.length) {
        throw new Error(`Index out of range! Total keys: ${privateKeys.length}`);
    }

    const privateKey = privateKeys[privateKeyIndex];
    const wallet = new ethers.Wallet(privateKey, provider);
    return { provider, wallet, totalWallets: privateKeys.length };
}

module.exports = setupProviderAndWallet;
