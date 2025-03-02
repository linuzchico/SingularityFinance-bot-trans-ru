const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Read WrappedSFI ABI
const wrappedSFIABI = JSON.parse(fs.readFileSync(path.join(__dirname, 'ABI', 'WrappedSFI.json'), 'utf8'));

// Setting contract addresses
const STAKING_CONTRACT_ADDRESS = '0x22Dbdc9e8dd7C5E409B014BBcb53a3ef39736515';
const WRAPPED_SFI_ADDRESS = '0x6dC404EFd04B880B0Ab5a26eF461b63A12E3888D';

// Partial ABI definition
const partialStakingABI = [
 {
 "inputs": [],
 "name": "claim",
 "outputs": [],
 "stateMutability": "nonpayable",
 "type": "function"
 },
 {
 "inputs": [
 {
 "internalType": "uint256",
 "name": "_amount",
 "type": "uint256"
 }
 ],
 "name": "withdrawAndClaim",
 "outputs": [],
 "stateMutability": "nonpayable",
 "type": "function"
 },
 {
 "inputs": [
 {
 "internalType": "uint256",
 "name": "_amount",
 "type": "uint256"
 },
 {
 "internalType": "uint256",
 "name": "_lockingPeriod",
 "type": "uint256"
 }
 ],
 "name": "deposit",
 "outputs": [],
 "stateMutability": "nonpayable",
 "type": "function"
 },
 {
 "inputs": [
 {
 "internalType": "address",
 "name": "account",
 "type": "address"
 }
 ],
 "name": "userInfo",
 "outputs": [
 {
 "components": [
 {
 "internalType": "uint256",
 "name": "amount",
 "type": "uint256"
 },
 {
 "internalType": "uint256",
 "name": "lockDate",
 "type": "uint256"
 },
 {
 "internalType": "uint256",
 "name": "unlockDate",
 "type": "uint256"
},
{
"internalType": "uint256",
"name": "score",
"type": "uint256"
}
],
"internalType": "struct SDAOLockedStaking.UserInfo",
"name": "",
"type": "tuple"
}
],
"stateMutability": "view",
"type": "function"
}
];

// Function for retrying
async function retry(operation, maxRetries = 15) {
for (let attempt = 1; attempt <= maxRetries; attempt++) {
try {
return await operation();
} catch (error) {
if (attempt === maxRetries) {
logger.error(`All attempts failed, last error: ${error.message}`);
throw error;
}
logger.warn(`Attempt ${attempt} failed, retrying in 5 seconds...`);
await new Promise(resolve => setTimeout(resolve, 5000));
}
}
}

// Calculate the optimal locking period
function calculateOptimalLockingPeriod(unlockDate) {
const currentTimestamp = Math.floor(Date.now() / 1000);
const MAX_LOCKING_PERIOD = 360 * 24 * 60 * 60; // 360 days in seconds

if (unlockDate <= currentTimestamp) {
// If already unlocked, use the maximum locking period
return MAX_LOCKING_PERIOD;
} else {
// Calculate the remaining locking time
const remainingLockTime = unlockDate - currentTimestamp;
// Return the remaining locking time, but not more than the maximum locking period
return Math.min(remainingLockTime, MAX_LOCKING_PERIOD);
}
}

async function stakeTokens(wallet, amount) {
return retry(async () => {
const stakingContract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, partialStakingABI, wallet);
const wrappedSFIContract = new ethers.Contract(WRAPPED_SFI_ADDRESS, wrappedSFIABI, wallet);
const amountInWei = ethers.utils.parseEther(amount.toString());

try {
let optimalLockingPeriod;
const userInfo = await stakingContract.userInfo(wallet.address);
logger.info('Current user stake information:');
logger.info(`- Number of stakes: ${ethers.utils.formatEther(userInfo.amount)} WSFI`);
logger.info(`- Stake score: ${userInfo.score.toString()}`);

const hasExistingStake = userInfo.amount.gt(ethers.constants.Zero);

if (hasExistingStake) {
logger.info('Existing stakes');
optimalLockingPeriod = calculateOptimalLockingPeriod(userInfo.unlockDate.toNumber());
logger.info(`Calculated optimal locking period (seconds): ${optimalLockingPeriod}`);
} else {
logger.info('No stakes');
optimalLockingPeriod = 7776000; // 90 days
}

const wSFIBalance = await wrappedSFIContract.balanceOf(wallet.address);
logger.info(`wSFI Balance: ${ethers.utils.formatEther(wSFIBalance)} wSFI`);

if (wSFIBalance.lt(amountInWei)) {
throw new Error('Not enough wSFI funds');
}

logger.info('Approving staking contract tokens...');
const approveTx = await wrappedSFIContract.approve(STAKING_CONTRACT_ADDRESS, amountInWei);
await approveTx.wait();
logger.info('Approval successful');

logger.info('Calling staking contract to stake...');
const depositTx = await stakingContract.deposit(amountInWei, optimalLockingPeriod, {
gasLimit: 300000,
});

logger.info('Waiting for transaction confirmation...');
const receipt = await depositTx.wait();

if (receipt.status === 0) {
throw new Error('Transaction failed');
}

logger.info('Bid successful!');

logger.info('Waiting 10 seconds for bid to update...');
await new Promise(resolve => setTimeout(resolve, 10000));

const updatedUserInfo = await stakingContract.userInfo(wallet.address);
logger.info('Updated user bid info:');
logger.info(`- Stake amount: ${ethers.utils.formatEther(updatedUserInfo.amount)} SFI`);
logger.info(`- Bid Score: ${updatedUserInfo.score.toString()}`);

return receipt.transactionHash;
} catch (error) {
logger.error('Bid transaction failed:', error);
if (error.error && error.error.message) {
logger.error('Error details:', error.error.message);
}
throw error;
}
});
}

async function getStakedAmount(wallet) {
return retry(async () => {
try {
const stakingContract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, partialStakingABI, wallet.provider);
const userInfo = await stakingContract.userInfo(wallet.address);

const stakedAmount = ethers.utils.formatEther(userInfo.amount);

logger.info(`User stake amount ${wallet.address}: ${stakedAmount} WSFI`);

return stakedAmount;
} catch (error) {
logger.error("Error getting stake amount:", error);
throw error;
}
});
}

async function withdrawAndClaim(wallet, amount) {
return retry(async () => {
const stakingContract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, partialStakingABI, wallet);
const amountInWei = ethers.utils.parseEther(amount.toString());

try {
const userInfoBefore = await stakingContract.userInfo(wallet.address);
logger.info('Users betting information before withdrawal:');
logger.info(`- Amount of bets: ${ethers.utils.formatEther(userInfoBefore.amount)} SFI`);
logger.info(`- Score of bets: ${userInfoBefore.score.toString()}`);

if (userInfoBefore.amount.lt(amountInWei)) {
throw new Error('Not enough stakes to withdraw the specified amount');
}

logger.info('Request to withdraw amount:', amount, 'wSFI');

logger.info('Calling staking contract to withdraw and receive reward...');
const withdrawTx = await stakingContract.withdrawAndClaim(amountInWei, {
gasLimit: 300000,
});

logger.info('Waiting for transaction confirmation...');
const receipt = await withdrawTx.wait();

if (receipt.status === 0) {
logger.error(`Transaction failed. Transaction hash: ${receipt.transactionHash}`);
throw new Error('Transaction failed');
}

logger.info('Withdrawal and reward received successful!');

logger.info('Waiting 10 seconds to update...');
await new Promise(resolve => setTimeout(resolve, 10000));

const userInfoAfter = await stakingContract.userInfo(wallet.address);
logger.info('User's betting info after withdrawal:');
logger.info(`- Amount of bets: ${ethers.utils.formatEther(userInfoAfter.amount)} WSFI`);
logger.info(`- Score of bets: ${userInfoAfter.score.toString()}`);
const actualWithdrawn = userInfoBefore.amount.sub(userInfoAfter.amount);
logger.info(`Actual withdrawn amount: ${ethers.utils.formatEther(actualWithdrawn)} WSFI`);

return receipt.transactionHash;
} catch (error) {
logger.error('Failed to withdraw and receive reward:', error);
if (error.error && error.error.message) {
logger.error('Error details:', error.error.message);
}
throw error;
}
});
}

async function claim(wallet) {
return retry(async () => {
const stakingContract = new ethers.Contract(STAKING_CONTRACT_ADDRESS, partialStakingABI, wallet);

try {
logger.info('Calling staking contract to claim reward...');
const claimTx = await stakingContract.claim({
gasLimit: 200000,
});

logger.info('Waiting for transaction confirmation...');
const receipt = await claimTx.wait();

if (receipt.status === 0) {
logger.error(`Transaction failed. Transaction hash: ${receipt.transactionHash}`);
logger.error('Gas used:', receipt.gasUsed.toString());
throw new Error('Failed to execute transaction');
}

logger.info('Reward received successfully!');

const rewardEvent = receipt.logs.find(log => log.address === STAKING_CONTRACT_ADDRESS);
if (rewardEvent) {
const rewardAmount = ethers.utils.formatEther(rewardEvent.data);
logger.info('Amount of reward received:', rewardAmount, 'wSFI');
} else {
logger.error('Failed to get reward amount from transaction logs.');
}

logger.info(`Transaction hash: ${receipt.transactionHash}`);

return receipt.transactionHash;
} catch (error) {
logger.error('Failed to complete the operation to receive reward:', error);
if (error.error && error.error.message) {
 logger.error('Error details:', error.error.message);
 }
 throw error;
 }
 });
}

module.exports = { stakeTokens, withdrawAndClaim, claim, getStakedAmount };
