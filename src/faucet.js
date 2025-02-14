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
        console.error('Не удалось решить капчу:', error);
        throw error;
    }
}

async function claimFaucet(address) {
    try {
        const captchaToken = await solveCaptcha();
        if (!captchaToken) {
            console.error(`Не удалось получить токен Anti-captcha, адрес: ${address}`);
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

        // Первый шаг: запуск сессии
        logger.info('Запуск сессии для:', address);
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
            logger.error(`Не удалось запустить сессию для ${address}. Статус код: ${sessionResponse.status}`);
            return false;
        }

        if (sessionResponse.data.status === 'failed') {
            if (sessionResponse.data.failedCode === 'RECURRING_LIMIT') {
                logger.info(`Адрес ${address} уже получил средства. Причина: ${sessionResponse.data.failedReason}`);
                return { status: 'already_claimed', message: sessionResponse.data.failedReason };
            } else {
                logger.error(`Не удалось запустить сессию для ${address}. Причина: ${sessionResponse.data.failedReason}`);
                return { status: 'failed', message: sessionResponse.data.failedReason };
            }
        }
        
        if (!sessionResponse.data.session) {
            logger.error(`Не удалось запустить сессию для ${address}. Не получен действительный ID сессии`);
            return { status: 'failed', message: 'Не получен действительный ID сессии' };
        }

        // Получение ID сессии из ответа
        const sessionId = sessionResponse.data.session;

        // Второй шаг: получение награды
        const claimResponse = await axios.post(
            'https://faucet-testnet.singularityfinance.ai/api/claimReward',
            {
                session: sessionId,
                captchaToken: await solveCaptcha() // Решение капчи снова
            },
            {
                headers: headers,
                httpsAgent: proxy,
                proxy: false
            }
        );

        if (claimResponse.status !== 200) {
            logger.error(`Не удалось получить награду для ${address}. Статус код: ${claimResponse.status}`);
            return false;
        }
        if (claimResponse.data.status === 'claiming' && claimResponse.data.session) {
            logger.info(`Успешное получение награды для ${address}:`, claimResponse.data);
            return { status: 'success', data: claimResponse.data };
        } else {
            logger.error(`Не удалось получить награду для ${address}. Ответ сервера:`, claimResponse.data);
            return { status: 'failed', message: 'Не удалось получить награду' };
        }
    } catch (error) {
        logger.error(`Ошибка при получении награды для ${address}:`, error.message);
        if (error.response) {
            logger.error('Статус ответа:', error.response.status);
            logger.error('Данные ответа:', error.response.data);
        } else if (error.request) {
            logger.error('Ответ не получен:', error.request);
        }
        throw error; // Бросить ошибку для захвата механизмом повторных попыток
    }
}

async function claimFaucetWithRetry(address, maxRetries = 3, delay = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await claimFaucet(address);
            
            // Если адрес уже получил средства, вернуть результат без повторных попыток
            if (result.status === 'already_claimed') {
                return result;
            }
            
            // Если успешно, вернуть результат
            if (result.status === 'success') {
                return result;
            }
            
            // Если другая ошибка, продолжить попытки
            logger.error(`Попытка ${attempt} не удалась, ждем ${delay/1000} секунд перед повторной попыткой...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
            if (attempt === maxRetries) {
                logger.error(`Последняя попытка не удалась, адрес: ${address}`, error);
                return { status: 'failed', message: 'Не удалось после нескольких попыток' };
            }
            logger.error(`Ошибка при попытке ${attempt}, ждем ${delay/1000} секунд перед повторной попыткой...`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return { status: 'failed', message: 'Достигнуто максимальное количество попыток' };
}

module.exports = { claimFaucetWithRetry };