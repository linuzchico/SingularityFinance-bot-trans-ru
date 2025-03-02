### SingularityFinance Bot Automatic Tasks Script

This script is designed for automating tasks for SingularityFinance. Follow my Twitter for more scripts: [Twitter Creator](https://x.com/linuzchico).

#### From Me
- The `walletProcess_original.js` did not include Unstaking.
- DEX Swap was done only twice, but it should be three times.
- DEX Remove Liquidity was not working.

### Features
- Faucet fund retrieval
- Cross-chain operations
- SFI and WSFI exchange
- Staking, unstaking, and rewards retrieval
- Support for parallel processing of multiple wallets
- Fully automatic operation, no human intervention required

### Usage Instructions
1. Ensure Node.js is installed on the system.
2. Clone the repository:
   ```
   git clone https://github.com/linuzchico/singularityfinance-bot
   cd singularityfinance-bot
   ```
3. Install dependencies:
   ```
   npm install
   ```
   If an error occurs at the beginning, try:
   ```
   npm uninstall ethers
   npm install ethers@5
   ```

### Configuration
1. Add the Anti-captcha API key in the `.env` file in the root directory.
2. Add wallet private keys to `config/private_key.list`, one per line.

### Usage
Run the script:
```
node index.js
```
The script will run a separate process for each wallet in an infinite loop, sleeping for 24 hours.

### Note
- This script uses Anti-captcha for solving captchas. Ensure sufficient funds on Anti-captcha.
- Registration link for Anti-captcha: [Anti-captcha Registration](https://getcaptchasolution.com/lhwl0mkjf2)
- The script is open-source and runs locally at your own risk.
- It is recommended to use a new wallet. The author is not responsible for losses caused.
- Adjust operation parameters according to your hardware capabilities to avoid excessive load.
