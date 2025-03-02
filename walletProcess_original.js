// walletProcess.js
const ethers = require('ethers');
const logger = require('./src/logger');
const erc20ABI = require('./src/ABI/ERC20.json');
const setupProviderAndWallet = require('./walletSetup');
const { stakeTokens, withdrawAndClaim, claim, getStakedAmount } = require('./src/staking');
const { claimFaucetWithRetry } = require('./src/faucet');
const { depositSFI, withdrawSFI, getSFIBalance, getWSFIBalance } = require('./src/depositSFI');
const { crossChainTransferWithRetry } = require('./src/crossChainTransfer');
const { 
    swapExactETHForTokens, 
    swapExactTokensForETH,
    swapExactTokensForTokens,
    addLiquidity,
    addLiquidityETH,
    removeLiquidity,
    removeLiquidityETH,
    getAmountsOut,
    getTokenBalance,
    getPair,
    DEX_CONTRACT_ADDRESS  
} = require('./src/DEX');

// Define constants
const RATIOS = {
    // SFI distribution
    SFI_TO_SWAP: 0.05,    // 8% SFI swap for AIMM
    SFI_TO_WSFI: 0.92,    // 92% SFI conversion to WSFI
    
    // WSFI distribution
    WSFI_TO_SWAP: 0.05,   // 8% WSFI swap for AIMM
    WSFI_TO_STAKE: 0.03,  // 5% single staking (total 10%)
    WSFI_TO_LP: 0.09      // about 12% for LP
};

const WSFI_THRESHOLD = 4;  // Receive funds if WSFI balance is below 4
const SFI_ADDRESS = "0x34Be5b8C30eE4fDe069DC878989686aBE9884470";
const WSFI_ADDRESS = "0x6dC404EFd04B880B0Ab5a26eF461b63A12E3888D";
const AIMM_ADDRESS = "0xAa4aFA7C07405992e3f6799dCC260D389687077a";
const LP_ADDRESS = "0xcc922d9E5DaB15513c6500B67459502A6C2e0F3C";

async function runWalletOperations(walletIndex) {
    const { wallet, provider } = setupProviderAndWallet(walletIndex);
    const address = wallet.address;

    try {
        logger.info(`Starting wallet processing ${walletIndex} (${address})`);

        // 1. Check WSFI balance, receive funds if balance is below threshold
        const wsfiBalance = await getWSFIBalance(wallet);
        if (wsfiBalance < WSFI_THRESHOLD) {
            logger.info(`Current WSFI balance (${wsfiBalance}) is below ${WSFI_THRESHOLD}, receiving funds`);
            const result = await claimFaucetWithRetry(address);
            switch(result.status) {
                case 'success':
                    logger.info('Successfully received funds from faucet', result.data);
                    break;
                case 'already_claimed':
                    logger.warn('Funds already claimed from faucet', result.message);
                    break;
                case 'failed':
                    logger.error('Failed to receive funds from faucet', result.message);
                    break;
                default:
                    logger.info('Unknown status', result);
            }
            await new Promise(resolve => setTimeout(resolve, 10000));
        }

        // 2. Convert 92% SFI to WSFI
        const sfiBalance = await getSFIBalance(wallet);
        const sfiToConvert = sfiBalance * RATIOS.SFI_TO_WSFI;
        logger.info(`Converting ${sfiToConvert} SFI to WSFI`);
        await depositSFI(wallet, sfiToConvert);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 3. Swap 8% SFI for AIMM
        const sfiToSwap = sfiBalance * RATIOS.SFI_TO_SWAP;
        logger.info(`Swapping ${sfiToSwap} SFI for AIMM`);
        try {
            await swapExactETHForTokens(
                wallet,
                sfiToSwap.toString(),
                30,
                [WSFI_ADDRESS, AIMM_ADDRESS],  
                ethers.constants.MaxUint256
            );
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Failed to swap SFI for AIMM:', error.message);
            throw error;
        }

        // 4. Swap 8% WSFI for AIMM
        const currentWSFIBalance = await getWSFIBalance(wallet);
        const wsfiToSwap = currentWSFIBalance * RATIOS.WSFI_TO_SWAP;
        logger.info(`Swapping ${wsfiToSwap} WSFI for AIMM`);
        try {
            const swapTx2 = await swapExactTokensForTokens(
                wallet,
                wsfiToSwap.toString(),
                30,
                [WSFI_ADDRESS, AIMM_ADDRESS],
                "115792089237316195423570985008687907853269984665640564039457584007913129639935"
            );
            logger.info('Waiting for WSFI to AIMM swap transaction confirmation...');
            await swapTx2.wait();
            logger.info('WSFI to AIMM swap transaction confirmed');
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Failed to swap WSFI for AIMM:', error.message);
            throw error;
        }

        // 5. First staking 5% WSFI
        const wsfiToStake = currentWSFIBalance * RATIOS.WSFI_TO_STAKE;
        logger.info(`First staking ${wsfiToStake} WSFI`);
        try {
            await stakeTokens(wallet, wsfiToStake);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Failed to perform the first staking:', error.message);
            throw error;
        }

        // 6. First Claim
        logger.info("Performing the first Claim");
        try {
            await claim(wallet);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('First Claim failed:', error.message);
            throw error;
        }

        // 7. Second staking 5% WSFI
        logger.info(`Second staking ${wsfiToStake} WSFI`);
        try {
            await stakeTokens(wallet, wsfiToStake);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Second staking failed:', error.message);
            throw error;
        }

        // 8. Second Claim
        logger.info("Performing the second Claim");
        try {
            await claim(wallet);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Second Claim failed:', error.message);
            throw error;
        }

        // 9. Creating LP
        try {
            // Get balances of the two tokens
            const aimmBalance = await getTokenBalance(wallet, AIMM_ADDRESS);
            const wsfiBalance = await getTokenBalance(wallet, WSFI_ADDRESS);
            
            if (!aimmBalance || aimmBalance.isZero()) {
                throw new Error('AIMM balance is 0, cannot create LP');
            }
            if (!wsfiBalance || wsfiBalance === 0) {
                throw new Error('WSFI balance is 0, cannot create LP');
            }

            // Randomly select the amount of AIMM in the range from 0.05 to 0.15
            const minAimm = 0.05;
            const maxAimm = 0.15;
            const random = Math.floor(Math.random() * 1000);
            let aimmToUse = minAimm + (maxAimm - minAimm) * random / 1000;

            // Ensure it does not exceed 50% of the balance (using actual values)
            const aimmBalanceNumber = parseFloat(ethers.utils.formatUnits(aimmBalance, 18));
            if (aimmToUse > aimmBalanceNumber / 2) {
                aimmToUse = aimmBalanceNumber / 2;
            }

            // Calculate the required amount of WSFI for the pair (WSFI:AIMM = 1:0.7)
            let wsfiForLP = aimmToUse * 10 / 7;

            // Ensure it does not exceed 50% of the balance
            if (wsfiForLP > wsfiBalance / 2) {
                wsfiForLP = wsfiBalance / 2;
                // Recalculate the amount of AIMM
                aimmToUse = wsfiForLP * 7 / 10;
            }

            // Logging using 3 decimal places
            logger.info(`Creating LP: using ${wsfiForLP.toFixed(3)} WSFI and ${aimmToUse.toFixed(3)} AIMM`);

            // Direct input of numbers, the addLiquidity function inside uses parseEther for conversion to minimum units
            await addLiquidity(
                wallet,
                WSFI_ADDRESS,
                AIMM_ADDRESS,
                wsfiForLP,
                aimmToUse,
                30,
                "115792089237316195423570985008687907853269984665640564039457584007913129639935"
            );
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Failed to add liquidity:', error.message);
            throw error;
        }

        // 10. Removing liquidity
        try {
            // Get LP balance
            const pair = await getPair(wallet, WSFI_ADDRESS, AIMM_ADDRESS);
            const lpToken = new ethers.Contract(pair, erc20ABI, wallet);
            const lpBalance = await lpToken.balanceOf(wallet.address);
            const lpBalanceFormatted = ethers.utils.formatEther(lpBalance);
            
            if (lpBalance.isZero()) {
                throw new Error('LP balance is 0, cannot remove liquidity');
            }

            // Check allowance
            const allowance = await lpToken.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
            if (allowance.lt(lpBalance)) {
                logger.info("Authorizing LP tokens...");
                const approveTx = await lpToken.approve(DEX_CONTRACT_ADDRESS, ethers.constants.MaxUint256);
                const approveReceipt = await approveTx.wait();
                logger.info(`LP tokens authorization successful, transaction hash: ${approveReceipt.transactionHash}`);
                
                // Recheck successful authorization
                const newAllowance = await lpToken.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
                if (newAllowance.lt(lpBalance)) {
                    throw new Error('Failed to authorize LP tokens');
                }
            }
            
            // Randomly select the percentage to remove from 25%, 50%, 75%, 100%
            const percentages = [25, 50, 75, 100];
            const selectedPercentage = percentages[Math.floor(Math.random() * percentages.length)];
            const lpToRemove = lpBalance.mul(selectedPercentage).div(100);
            logger.info(`Removing ${selectedPercentage}% LP, amount: ${ethers.utils.formatEther(lpToRemove)}`);

            await removeLiquidity(
                wallet,
                WSFI_ADDRESS,
                AIMM_ADDRESS,
                lpToRemove,
                30  // Increase slippage to 30% due to high market volatility
            );
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Failed to remove liquidity:', error.message);
            throw error;
        }

        logger.info(`Wallet operations ${walletIndex} successfully completed`);
        process.send(`Wallet operations ${walletIndex} successfully completed`);

    } catch (error) {
        logger.error(`Wallet operations ${walletIndex} failed:`, error);
        process.send(`Wallet operations ${walletIndex} failed: ${error.message}`);
    }
}

const walletIndex = parseInt(process.argv[2], 10);
runWalletOperations(walletIndex).catch(error => {
    logger.error(`Wallet operations ${walletIndex} failed:`, error);
    process.exit(1);
});
