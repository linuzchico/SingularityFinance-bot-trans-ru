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
    SFI_TO_SWAP: 0.05,    // 8% SFI swap to AIMM
    SFI_TO_WSFI: 0.92,    // 92% SFI conversion to WSFI
    
    // WSFI distribution
    WSFI_TO_SWAP: 0.05,   // 8% WSFI swap to AIMM
    WSFI_TO_STAKE: 0.03,  // 5% single staking (total 10%)
    WSFI_TO_LP: 0.09      // about 12% for LP
};

const WSFI_THRESHOLD = 4;  // Get funds if WSFI balance is below 4
const SFI_ADDRESS = "0x34Be5b8C30eE4fDe069DC878989686aBE9884470";
const WSFI_ADDRESS = "0x6dC404EFd04B880B0Ab5a26eF461b63A12E3888D";
const AIMM_ADDRESS = "0xAa4aFA7C07405992e3f6799dCC260D389687077a";
const LP_ADDRESS = "0xcc922d9E5DaB15513c6500B67459502A6C2e0F3C";

async function runWalletOperations(walletIndex) {
    const { wallet, provider } = setupProviderAndWallet(walletIndex);
    const address = wallet.address;

    try {
        logger.info(`Starting wallet processing ${walletIndex} (${address})`);

        // 1. Check WSFI balance, get funds if balance is below the threshold
        try {
            const wsfiBalance = await getWSFIBalance(wallet);
            if (wsfiBalance < WSFI_THRESHOLD) {
                logger.info(`Current WSFI balance (${wsfiBalance}) is below ${WSFI_THRESHOLD}, getting funds`);
                const result = await claimFaucetWithRetry(address);
                switch(result.status) {
                    case 'success':
                        logger.info('Successfully got funds from the faucet', result.data);
                        break;
                    case 'already_claimed':
                        logger.warn('Funds have already been claimed from the faucet', result.message);
                        break;
                    case 'failed':
                        logger.error('Failed to get funds from the faucet', result.message);
                        break;
                    default:
                        logger.info('Unknown status', result);
                }
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        } catch (error) {
            logger.error('Error checking WSFI balance or getting funds:', error.message);
        }

        // 2. Convert 92% SFI to WSFI
        try {
            const sfiBalance = await getSFIBalance(wallet);
            if (sfiBalance >= 9) {
                const sfiToConvert = sfiBalance * RATIOS.SFI_TO_WSFI;
                logger.info(`Converting ${sfiToConvert} SFI to WSFI`);
                await depositSFI(wallet, sfiToConvert);
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                logger.warn('SFI balance insufficient for conversion, skipping this step');
            }
        } catch (error) {
            logger.error('Error converting SFI to WSFI:', error.message);
        }

        // 3. Swap 8% SFI to AIMM
        try {
            const sfiToSwap = sfiBalance * RATIOS.SFI_TO_SWAP;
            logger.info(`Swapping ${sfiToSwap} SFI to AIMM`);
            await swapExactETHForTokens(
                wallet,
                sfiToSwap.toString(),
                30,
                [WSFI_ADDRESS, AIMM_ADDRESS],  
                ethers.constants.MaxUint256
            );
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Failed to swap SFI to AIMM:', error.message);
        }

        // 4. Swap 8% WSFI to AIMM
        try {
            const currentWSFIBalance = await getWSFIBalance(wallet);
            const wsfiToSwap = currentWSFIBalance * RATIOS.WSFI_TO_SWAP;
            logger.info(`Swapping ${wsfiToSwap} WSFI to AIMM`);
            let i = 0;
            while (i < 2) {
                logger.warn(`Attempt ${i + 1} to swap WSFI to AIMM`);
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
                i++;
            }
        } catch (error) {
            logger.error('Failed to swap WSFI to AIMM:', error.message);
        }

        // 5. First staking 5% WSFI
        try {
            const wsfiToStake = currentWSFIBalance * RATIOS.WSFI_TO_STAKE;
            logger.info(`First staking ${wsfiToStake} WSFI`);
            await stakeTokens(wallet, wsfiToStake);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Failed to perform the first staking:', error.message);
        }

        // 6. First Claim
        try {
            logger.info("Performing the first Claim");
            await claim(wallet);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('First Claim failed:', error.message);
        }

        // 7. Second staking 5% WSFI
        try {
            logger.info(`Second staking ${wsfiToStake} WSFI`);
            await stakeTokens(wallet, wsfiToStake);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Second staking failed:', error.message);
        }

        // 8. Second Claim
        try {
            logger.info("Performing the second Claim");
            await claim(wallet);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Second Claim failed:', error.message);
        }

        // 8.1 withdrawAndClaim (after the second Claim)
        try {
            logger.info("Performing withdrawAndClaim");
            await withdrawAndClaim(wallet, 0.01);
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('withdrawAndClaim failed:', error.message);
        }

        // 9. Create LP
        try {
            const aimmBalance = await getTokenBalance(wallet, AIMM_ADDRESS);
            const wsfiBalance = await getTokenBalance(wallet, WSFI_ADDRESS);
            if (!aimmBalance || aimmBalance.isZero()) {
                throw new Error('AIMM balance is 0, cannot create LP');
            }
            if (!wsfiBalance || wsfiBalance === 0) {
                throw new Error('WSFI balance is 0, cannot create LP');
            }
            const minAimm = 0.05;
            const maxAimm = 0.15;
            const random = Math.floor(Math.random() * 1000);
            let aimmToUse = minAimm + (maxAimm - minAimm) * random / 1000;
            const aimmBalanceNumber = parseFloat(ethers.utils.formatUnits(aimmBalance, 18));
            if (aimmToUse > aimmBalanceNumber / 2) {
                aimmToUse = aimmBalanceNumber / 2;
            }
            let wsfiForLP = aimmToUse * 10 / 7;
            if (wsfiForLP > wsfiBalance / 2) {
                wsfiForLP = wsfiBalance / 2;
                aimmToUse = wsfiForLP * 7 / 10;
            }
            logger.info(`Creating LP: using ${wsfiForLP.toFixed(3)} WSFI and ${aimmToUse.toFixed(3)} AIMM`);
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
        }

        // 10. Remove liquidity
        try {
            const pair = await getPair(wallet, WSFI_ADDRESS, AIMM_ADDRESS);
            const lpToken = new ethers.Contract(pair, erc20ABI, wallet);
            const lpBalance = await lpToken.balanceOf(wallet.address);
            const lpBalanceFormatted = ethers.utils.formatEther(lpBalance);
            if (lpBalance.isZero()) {
                throw new Error('LP balance is 0, cannot remove liquidity');
            }
            const allowance = await lpToken.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
            if (allowance.lt(lpBalance)) {
                logger.info("Authorizing LP tokens...");
                const approveTx = await lpToken.approve(DEX_CONTRACT_ADDRESS, ethers.constants.MaxUint256);
                const approveReceipt = await approveTx.wait();
                logger.info(`LP token authorization successful, transaction hash: ${approveReceipt.transactionHash}`);
                const newAllowance = await lpToken.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
                if (newAllowance.lt(lpBalance)) {
                    throw new Error('Failed to authorize LP tokens');
                }
            }
            const percentages = [25, 50, 75, 100];
            const selectedPercentage = percentages[Math.floor(Math.random() * percentages.length)];
            const lpToRemove = lpBalance.mul(selectedPercentage).div(100);
            logger.info(`Removing ${selectedPercentage}% LP, amount: ${ethers.utils.formatEther(lpToRemove)}`);
            await removeLiquidity(
                wallet,
                WSFI_ADDRESS,
                AIMM_ADDRESS,
                lpToRemove,
                30
            );
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            logger.error('Failed to remove liquidity:', error.message);
        }

        logger.info(`Wallet operations ${walletIndex} completed successfully`);
        process.send(`Wallet operations ${walletIndex} completed successfully`);

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
