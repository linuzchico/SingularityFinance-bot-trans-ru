const ethers = require('ethers');
const logger = require('./logger');
const path = require('path');
require('dotenv').config();
const erc20ABI = require('./ABI/ERC20.json');
const wrappedSFIABI = require('./ABI/WrappedSFI.json');
const pairABI = require('./ABI/Pair.json');

// Read ABI file
const dexABI = require(path.join(__dirname, 'ABI', 'DEX.json'));

// DEX Router contract address
const DEX_CONTRACT_ADDRESS = '0xFEccff0ecf1cAa1669A71C5E00b51B48E4CBc6A1';
const WSFI_CONTRACT_ADDRESS = '0x6dC404EFd04B880B0Ab5a26eF461b63A12E3888D'; // The address has been corrected taking into account the checksum

// Helper function: delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function for repeating the operation
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

// Swap ETH for sfi token on AIMM
async function swapExactETHForTokens(wallet, amountIn, slippagePercent, path, deadline) {
return retryOperation(async () => {
const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);

// 1. Check ETH balance
const ethBalance = await wallet.provider.getBalance(wallet.address);
const amountToSwap = ethers.utils.parseEther(amountIn.toString());
if (ethBalance.lt(amountToSwap)) {
throw new Error(`Not enough ETH, ${amountIn} ETH required, but only ${ethers.utils.formatEther(ethBalance)} ETH available`);
}

// 2. Get expected amount of tokens
const amountsOut = await router.getAmountsOut(
amountToSwap,
path
);

if (!amountsOut || amountsOut.length < 2) {
throw new Error('Unable to get expected amount to swap');
}

const expectedAmount = amountsOut[1];
logger.info(`Expected amount of tokens: ${ethers.utils.formatEther(expectedAmount)}`);

// 3. Calculate the minimum amount to accept taking slippage into account
const amountOutMin = expectedAmount.mul(100 - slippagePercent).div(100);
logger.info(`Slippage set to ${slippagePercent}%, minimum amount to accept: ${ethers.utils.formatEther(amountOutMin)} tokens`);

// 4. Performing the swap
logger.info(`Exchanging ${amountIn} ETH for tokens...`);
const tx = await router.swapExactETHForTokens(
amountOutMin,
path,
wallet.address,
deadline,
{ value: amountToSwap }
);

const receipt = await tx.wait();
logger.info(`Swap completed, transaction hash: ${receipt.transactionHash}`);

// Receiving the token balance after the transaction
const targetTokenContract = new ethers.Contract(path[1], erc20ABI, wallet);
const balance = await targetTokenContract.balanceOf(wallet.address);
logger.info(`Current token balance: ${ethers.utils.formatEther(balance)}`);

return receipt.transactionHash;
 });
}

// Exchange token for ETH
async function swapExactTokensForETH(wallet, amountIn, slippagePercent, path, deadline) {
 return retryOperation(async() => {
 const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);

 // 1. Balance check
 const isWSFI = path[0].toLowerCase() === WSFI_CONTRACT_ADDRESS.toLowerCase();
 const tokenContract = new ethers.Contract(path[0], isWSFI ? wrappedSFIABI : erc20ABI, wallet);
 const tokenBalance = await tokenContract.balanceOf(wallet.address);
 const amountToSwap = ethers.utils.parseEther(amountIn.toString());
 if (tokenBalance.lt(amountToSwap)) {
throw new Error(`Not enough tokens, ${amountIn} tokens required, but only ${ethers.utils.formatEther(tokenBalance)} available`);
}

// 2. Checking and performing authorization
logger.info("Checking authorization status...");
const allowance = await tokenContract.allowance(wallet.address, DEX_CONTRACT_ADDRESS);

if (allowance.lt(amountToSwap)) {
logger.info("Authorizing DEX contract...");
const approveTx = await tokenContract.approve(
DEX_CONTRACT_ADDRESS,
ethers.constants.MaxUint256 // Authorize for the maximum value to avoid re-authorization
);
await approveTx.wait();
logger.info("Authorization successful");
} else {
logger.info("Authorization already completed");
}

// 3. Get the expected amount of ETH
const amountsOut = await router.getAmountsOut(
ethers.utils.parseEther(amountIn.toString()),
path
);

if (!amountsOut || amountsOut.length < 2) {
throw new Error('Unable to get the expected amount for the exchange');
}

const expectedAmount = amountsOut[1];
logger.info(`Expected amount of ETH: ${ethers.utils.formatEther(expectedAmount)}`);

// 4. Calculate the minimum amount to accept taking slippage into account
const amountOutMin = expectedAmount.mul(100 - slippagePercent).div(100);
logger.info(`Slippage set to ${slippagePercent}%, minimum amount accepted: ${ethers.utils.formatEther(amountOutMin)} ETH`);

// 5. Performing the swap
const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
ethers.utils.parseEther(amountIn.toString()),
amountOutMin,
path,
wallet.address,
deadline
);

const receipt = await tx.wait();
logger.info(`Swap completed, transaction hash: ${receipt.transactionHash}`);

// Receiving ETH balance after the transaction
const ethBalance = await wallet.provider.getBalance(wallet.address);
logger.info(`Current ETH balance: ${ethers.utils.formatEther(ethBalance)}`);

return receipt.transactionHash;
});
}

// Swap token for WSFI token on AIMM (taking into account slippage)
async function swapExactTokensForTokens(wallet, amountIn, slippagePercent, path, deadline) {
return retryOperation(async () => {
const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);

// 1. Check balance
const isWSFI = path[0].toLowerCase() === WSFI_CONTRACT_ADDRESS.toLowerCase();
const tokenContract = new ethers.Contract(path[0], isWSFI ? wrappedSFIABI : erc20ABI, wallet);
const tokenBalance = await tokenContract.balanceOf(wallet.address);
const amountToSwap = ethers.utils.parseEther(amountIn.toString());
if (tokenBalance.lt(amountToSwap)) {
throw new Error(`Not enough tokens, ${amountIn} required, but only ${ethers.utils.formatEther(tokenBalance)} available`);
}

// 2. Checking and executing authorization
logger.info("Checking authorization status...");
const allowance = await tokenContract.allowance(wallet.address, DEX_CONTRACT_ADDRESS);

if (allowance.lt(amountToSwap)) {
logger.info("Authorizing DEX contract...");
const approveTx = await tokenContract.approve(
DEX_CONTRACT_ADDRESS,
ethers.constants.MaxUint256
);
await approveTx.wait();
logger.info("Authentication successful");
} else {
logger.info("Authentication already completed");
}

// 3. Getting the expected amount of tokens
const amountsOut = await router.getAmountsOut(
amountToSwap,
path
);

if (!amountsOut || amountsOut.length < 2) {
throw new Error('Unable to get expected amount to swap');
}

const expectedAmount = amountsOut[1];
logger.info(`Expected amount of tokens: ${ethers.utils.formatEther(expectedAmount)}`);

// 4. Calculating the minimum amount to accept taking slippage into account
const amountOutMin = expectedAmount.mul(100 - slippagePercent).div(100);
logger.info(`Slippage set to ${slippagePercent}%, minimum accepted amount: ${ethers.utils.formatEther(amountOutMin)} tokens`);

// 5. Performing the exchange
const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
amountToSwap,
amountOutMin,
path,
wallet.address,
deadline
);

logger.info('Waiting for transaction confirmation...');
const receipt = await tx.wait();
logger.info(`Swap completed, transaction hash: ${receipt.transactionHash}`);

// Waiting for blockchain state update
await new Promise(resolve => setTimeout(resolve, 5000));

// Receiving token balance after transaction
try {
const targetTokenContract = new ethers.Contract(path[1], erc20ABI, wallet);
const balance = await targetTokenContract.balanceOf(wallet.address);
logger.info(`Current token balance: ${ethers.utils.formatEther(balance)}`);
} catch (error) {
logger.warn('Failed to get token balance, but transaction completed', error.message);
}

return tx;
});
}

// Add liquidity (Token + Token) WSFI and AIMM
async function addLiquidity(wallet, tokenA, tokenB, amountA, amountB, slippagePercent, deadline) {
return retryOperation(async () => {
const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);

// 1. Check balance and token authorization
const tokenAContract = new ethers.Contract(tokenA, erc20ABI, wallet);
const tokenBContract = new ethers.Contract(tokenB, erc20ABI, wallet);

const amountADesired = ethers.utils.parseEther(amountA.toString());
const amountBDesired = ethers.utils.parseEther(amountB.toString());

// Check balance
const balanceA = await tokenAContract.balanceOf(wallet.address);
const balanceB = await tokenBContract.balanceOf(wallet.address);

if (balanceA.lt(amountADesired)) {
throw new Error(`Not enough A tokens, ${amountA} tokens required, but only ${ethers.utils.formatEther(balanceA)} available`);
}
if (balanceB.lt(amountBDesired)) {
throw new Error(`Not enough B tokens, ${amountB} tokens required, but only ${ethers.utils.formatEther(balanceB)} available`);
}

// Check authorization
const allowanceA = await tokenAContract.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
const allowanceB = await tokenBContract.allowance(wallet.address, DEX_CONTRACT_ADDRESS);

if (allowanceA.lt(amountADesired)) {
logger.info("Authorizing token A...");
const approveTxA = await tokenAContract.approve(DEX_CONTRACT_ADDRESS, ethers.constants.MaxUint256);
await approveTxA.wait();
logger.info("Authorizing token A successful");
}

if (allowanceB.lt(amountBDesired)) {
logger.info("Authorizing token B...");
const approveTxB = await tokenBContract.approve(DEX_CONTRACT_ADDRESS, ethers.constants.MaxUint256);
await approveTxB.wait();
logger.info("Authorization of token B successful");
}

// 2. Calculating the minimum amount accepted taking slippage into account
const amountAMin = amountADesired.mul(100 - slippagePercent).div(100);
const amountBMin = amountBDesired.mul(100 - slippagePercent).div(100);

logger.info(`Add liquidity parameters:
- Input token A: ${ethers.utils.formatEther(amountADesired)} WSFI
- Input token B: ${ethers.utils.formatEther(amountBDesired)} AIMM
- Slippage: ${slippagePercent}%
- Minimum accepted amount of A: ${ethers.utils.formatEther(amountAMin)} WSFI
- Minimum accepted amount of B: ${ethers.utils.formatEther(amountBMin)} AIMM`);

// 3. Add liquidity
const tx = await router.addLiquidity(
tokenA,
tokenB,
amountADesired,
amountBDesired,
amountAMin,
amountBMin,
wallet.address,
deadline
);

const receipt = await tx.wait();
logger.info(`Liquidity added, transaction hash: ${receipt.transactionHash}`);

// 4. Getting LP token balance
const pair = await router.factory().then(factory =>
new ethers.Contract(factory, ['function getPair(address,address) view returns (address)'], wallet)
.getPair(tokenA, tokenB)
);
if (pair) {
 const lpToken = new ethers.Contract(pair, erc20ABI, wallet);
 const lpBalance = await lpToken.balanceOf(wallet.address);
 logger.info(`Current balance of LP tokens: ${ethers.utils.formatEther(lpBalance)}`);
 }

 return receipt.transactionHash;
 });
}

// Add liquidity (ETH + Token)
async function addLiquidityETH(wallet, token, tokenAmount, ethAmount, slippagePercent, deadline) {
return retryOperation(async () => {
const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);

// 1. Check ETH and token balance
const ethBalance = await wallet.provider.getBalance(wallet.address);
const ethToAdd = ethers.utils.parseEther(ethAmount.toString());
if (ethBalance.lt(ethToAdd)) {
throw new Error(`Not enough ETH, ${ethAmount} ETH required, but only ${ethers.utils.formatEther(ethBalance)} ETH available`);
}

const tokenContract = new ethers.Contract(token, erc20ABI, wallet);
const tokenToAdd = ethers.utils.parseEther(tokenAmount.toString());
const tokenBalance = await tokenContract.balanceOf(wallet.address);
if (tokenBalance.lt(tokenToAdd)) {
throw new Error(`Not enough tokens, ${tokenAmount} tokens required, but only ${ethers.utils.formatEther(tokenBalance)} available`);
}

// 2. Checking and performing authorization
const allowance = await tokenContract.allowance(wallet.address, DEX_CONTRACT_ADDRESS);
if (allowance.lt(tokenToAdd)) {
logger.info("Authorizing token...");
const approveTx = await tokenContract.approve(DEX_CONTRACT_ADDRESS, ethers.constants.MaxUint256);
await approveTx.wait();
logger.info("Authorization successful");
}

// 3. Calculating the minimum accepted amount taking slippage into account
const tokenAmountMin = tokenToAdd.mul(100 - slippagePercent).div(100);
const ethAmountMin = ethToAdd.mul(100 - slippagePercent).div(100);

logger.info(`Parameters for adding liquidity:
- Input ETH: ${ethers.utils.formatEther(ethToAdd)} ETH
- Input token: ${ethers.utils.formatEther(tokenToAdd)} tokens
- Slippage: ${slippagePercent}%
- Minimum amount of ETH to accept: ${ethers.utils.formatEther(ethAmountMin)} ETH
- Minimum amount of tokens to accept: ${ethers.utils.formatEther(tokenAmountMin)} tokens`);

// 4. Adding liquidity
const tx = await router.addLiquidityETH(
token,
tokenToAdd,
tokenAmountMin,
ethAmountMin,
wallet.address,
deadline,
{ value: ethToAdd }
);

const receipt = await tx.wait();
 logger.info(`Liquidity added, transaction hash: ${receipt.transactionHash}`);

 // 5. Getting the balance of LP tokens
 const wet = await router.WETH();
 const pair = await router.factory().then(factory =>
 new ethers.Contract(factory, ['function getPair(address,address) view returns (address)'], wallet)
 .getPair(token, wet)
 );

 if (pair) {
 const lpToken = new ethers.Contract(pair, erc20ABI, wallet);
 const lpBalance = await lpToken.balanceOf(wallet.address);
 logger.info(`Current balance of LP tokens: ${ethers.utils.formatEther(lpBalance)}`);
}

return receipt.transactionHash;
});
}

// Remove liquidity (Token + Token)
// tokenA - WSFI, tokenB - AIMM
// liquidity - amount of liquidity, calculated based on the total amount
// Add a constant to the beginning of DEX.js
const MAX_UINT256 = ethers.constants.MaxUint256;

// Change removeLiquidity function, use fixed deadline
async function removeLiquidity(wallet, tokenA, tokenB, liquidity, slippagePercent) { // Removed deadline parameter
return retryOperation(async () => {
const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);

// 1. Get pair address
const factory = await router.factory();
const factoryContract = new ethers.Contract(factory, ['function getPair(address,address) view returns (address)'], wallet);
const pair = await factoryContract.getPair(tokenA, tokenB);

if (!pair) {
throw new Error('Pair does not exist');
}
// 2. Get reserves
const pairContract = new ethers.Contract(pair, pairABI, wallet);
const [token0, token1] = await Promise.all([
pairContract.token0(),
pairContract.token1()
]);
const [reserve0, reserve1] = await pairContract.getReserves()
.then(([r0, r1]) => token0.toLowerCase() === tokenA.toLowerCase() ? [r0, r1] : [r1, r0]);

// 3. Calculate the minimum amount to accept
const totalSupply = await new ethers.Contract(pair, erc20ABI, wallet).totalSupply();

// Calculate expected amount (proportional)
const expectedAmountA = liquidity.mul(reserve0).div(totalSupply);
const expectedAmountB = liquidity.mul(reserve1).div(totalSupply);

// Apply slippage
const minAmountA = expectedAmountA.mul(100 - slippagePercent).div(100);
const minAmountB = expectedAmountB.mul(100 - slippagePercent).div(100);

logger.info(`Removing liquidity...`);
logger.info(`LP token address: ${pair}`);
logger.info(`LP quantity: ${ethers.utils.formatEther(liquidity)}`);
logger.info(`Slippage: ${slippagePercent}%`);
logger.info(`Expected amount:`);
logger.info(`- TokenA (${tokenA}): ${ethers.utils.formatEther(expectedAmountA)}`);
logger.info(`- TokenB (${tokenB}): ${ethers.utils.formatEther(expectedAmountB)}`);
logger.info(`Minimum accepted amount:`);
logger.info(`- TokenA: ${ethers.utils.formatEther(minAmountA)}`);
logger.info(`- TokenB: ${ethers.utils.formatEther(minAmountB)}`);

try {
const tx = await router.removeLiquidity(
tokenA,
tokenB,
liquidity, // Number of LP tokens
minAmountA, // Minimum amount of token A
minAmountB, // Minimum amount of token B
wallet.address,
ethers.constants.MaxUint256 // Using a fixed maximum value for deadline
);

logger.info('Transaction sent, waiting for confirmation...');
const receipt = await tx.wait();

if (receipt.status === 0) {
throw new Error('Transaction failed');
}

logger.info(`Liquidity removed! Transaction hash: ${receipt.transactionHash}`);
return receipt.transactionHash;
} catch (error) {
// Try to get more detailed information about the error
logger.error('Error deleting liquidity:');
logger.error(`- LP token address: ${pair}`);
logger.error(`- LP quantity: ${ethers.utils.formatEther(liquidity)}`);
logger.error(`- Token A address: ${tokenA}`);
logger.error(`- Token B address: ${tokenB}`);
logger.error(`- Error message: ${error.message}`);
if (error.data) {
logger.error(`- Error data: ${error.data}`);
}
throw error;
}
});
}

// Remove liquidity (ETH + Token)
async function removeLiquidityETH(wallet, token, liquidity, amountTokenMin, amountETHMin, deadline) {
 return retryOperation(async() => {
 const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);

 logger.info(`Removing ETH liquidity...`);
 const tx = await router.removeLiquidityETHSupportingFeeOnTransferTokens(
 token
 ethers.utils.parseEther(liquidity.toString()),
 ethers.utils.parseEther(amountTokenMin.toString()),
 ethers.utils.parseEther(amountETHMin.toString()),
 wallet.address,
 deadline
 );

logger.info('Transaction sent, awaiting confirmation...');
const receipt = await tx.wait();

logger.info(`Liquidity removed! Transaction hash: ${receipt.transactionHash}`);
return receipt.transactionHash;
});
}

async function getTokenBalance(wallet, tokenAddress) {
return retryOperation(async () => {
const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, wallet);
const balance = await tokenContract.balanceOf(wallet.address);

logger.info(`Token balance at ${wallet.address}: ${ethers.utils.formatEther(balance)}`);
return balance;
});
}
// Get the number of tokens at the output of the exchange
async function getAmountsOut(wallet, amountIn, path) {
return retryOperation(async () => {
const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet.provider);
const amounts = await router.getAmountsOut(
ethers.utils.parseEther(amountIn.toString()),
path
);
return amounts.map(amount => ethers.utils.formatEther(amount));
});
}

// Get the pair address
async function getPair(wallet, tokenA, tokenB) {
const router = new ethers.Contract(DEX_CONTRACT_ADDRESS, dexABI, wallet);
const factory = await router.factory();
const factoryContract = new ethers.Contract(factory, ['function getPair(address,address) view returns (address)'], wallet);
 const pair = await factoryContract.getPair(tokenA, tokenB);
 if (!pair) {
 throw new Error('Pair does not exist');
 }
 return pair;
}

module.exports = {
 swapExactETHForTokens,
 swapExactTokensForETH,
 swapExactTokensForTokens,
 addLiquidity
 addLiquidityETH
 removeLiquidity
 removeLiquidityETH
 getTokenBalance,
 getAmountsOut,
 getPair,
 DEX_CONTRACT_ADDRESS
};
