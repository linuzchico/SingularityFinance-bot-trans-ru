const axios = require('axios');
const logger = require('./logger');
const { HttpsProxyAgent } = require('https-proxy-agent');
const ac = require("@antiadmin/anticaptchaofficial");
const dns = require('dns');
require('dotenv').config();

dns.setServers(['8.8.8.8', '8.8.4.4']);

ac.setAPIKey(process.env.ANTICAPTCHA_API_KEY);

async function solveCaptcha() {
    try {
        const token = await ac.solveTurnstileProxyless(
            'https://faucet-testnet.singularityfinance.ai/api/startSession',
            '0x4AAAAAAA2Cr3HyNW-0RONo',
            '',
            ''
        );
        return token;
    } catch (error) {
        console.error('Failed to solve captcha:', error);
        throw error;
    }
}

async function claimFaucet(address) {
    try {
        const captchaToken = await solveCaptcha();
        if (!captchaToken) {
            console.error(`Failed to get Anti-captcha token, address: ${address}`);
            return false;
        }

        const proxyUrl = process.env.PROXY_URL;
        const proxy = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

        const headers = {
            'accept': '*/*',
            'accept-language': 'zh-CN,zh;q=0.9',
            'content-type': 'application/json',
            'origin': 'https://faucet-testnet.singularityfinance.ai',
            'referer': 'https://faucet-testnet.singularityfinance.ai/',
            'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        };

        // First step: start session
        logger.info('Starting session for:', address);
        const sessionResponse = await axios.post(
            'https://faucet-testnet.singularityfinance.ai/api/startSession',
            { addr: address, captchaToken: captchaToken },
            {
                headers: headers,
                httpsAgent: proxy,
                proxy: false
            }
        );

        if (sessionResponse.status !== 200) {
            logger.error(`Failed to start session for ${address}. Status code: ${sessionResponse.status}`);
            return false;
        }

        if (sessionResponse.data.status === 'failed') {
            if (sessionResponse.data.failedCode === 'RECURRING_LIMIT') {
                logger.info(`Address ${address} has already received funds. Reason: ${sessionResponse.data.failedReason}`);
                return { status: 'already_claimed', message: sessionResponse.data.failedReason };
            } else {
                logger.error(`Failed to start session for ${address}. Reason: ${sessionResponse.data.failedReason}`);
                return { status: 'failed', message: sessionResponse.data.failedReason };
            }
        }
        
        if (!sessionResponse.data.session) {
            logger.error(`Failed to start session for ${address}. No valid session ID received`);
            return { status: 'failed', message: 'No valid session ID received' };
        }

        // Get session ID from response
        const sessionId = sessionResponse.data.session;

        // Second step: claim reward
        const claimResponse = await axios.post(
            'https://faucet-testnet.singularityfinance.ai/api/claimReward',
            {
                session: sessionId,
                captchaToken: await solveCaptcha() // Solve captcha again
            },
            {
                headers: headers,
                httpsAgent: proxy,
                proxy: false
            }
        );

        if (claimResponse.status !== 200) {
            logger.error(`Failed to claim reward for ${address}. Status code: ${claimResponse.status}`);
            return false;
        }
        if (claimResponse.data.status === 'claiming' && claimResponse.data.session) {
            logger.info(`Successfully claimed reward for ${address}:`, claimResponse.data);
            return { status: 'success', data: claimResponse.data };
        } else {
            logger.error(`Failed to claim reward for ${address}. Server response:`, claimResponse.data);
            return { status: 'failed', message: 'Failed to claim reward' };
        }
    } catch (error) {
        logger.error(`Error while claiming reward for ${address}:`, error.message);
        if (error.response) {
            logger.error('Response status:', error.response.status);
            logger.error('Response data:', error.response.data);
        } else if (error.request) {
            logger.error('No response received:', error.request);
        }
        throw error; // Throw error to be caught by retry mechanism
    }
}

async function claimFaucetWithRetry(address, maxRetries = 3, delay = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await claimFaucet(address);
            
            // If address already received funds, return result without retries
            if (result.status === 'already_claimed') {
                return result;
            }
            
            // If successful, return result
            if (result.status === 'success') {
                return result;
            }
            
            // If other error, continue retries
            logger.error(`Attempt ${attempt} failed, waiting ${delay/1000} seconds before retrying...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
            if (attempt === maxRetries) {
                logger.error(`Last attempt failed, address: ${address}`, error);
                return { status: 'failed', message: 'Failed after multiple attempts' };
            }
            logger.error(`Error on attempt ${attempt}, waiting ${delay/1000} seconds before retrying...`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return { status: 'failed', message: 'Reached maximum number of attempts' };
}

module.exports = { claimFaucetWithRetry };
