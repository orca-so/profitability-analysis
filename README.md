# pnl-analysis

*This script measures the profitability of opening a position on Orca compared to holding the underlying tokens used to open the position instead.*

### What is profitability?

There are many metrics an LP can use to measure the profitability of a trading strategy or position. One very common approach is to compare the total ending value of the position (including fees earned) with the value of the tokens used to create the position had the LP merely held them instead. Accordingly, the price performance of holding the tokens over the duration of the position is an opportunity cost that the position must overcome in order to be profitable under that metric. This is the metric we use in this script, so when we talk about profitability, we are talking about the performance of the position adjusted for the opportunity cost of opening the position. In this context, the opportunity cost captures what is often referred to as impermanent loss or divergence loss. 

This approach attempts to control for the market performance of the tokens in question when evaluating whether opening the position was a good idea and is therefore not a measure of whether the total USD value of a position went up or down. Positions that are profitable compared to holding can still lose money on a USD basis, and positions that are not profitable compared to holding can still make money on a USD basis.

### To get started

1. Click the green "Code" dropdown and click download ZIP.
2. Unzip the folder and move it to preferred location (e.g., Desktop).
3. Open Terminal. type `cd {FOLDER_PATH}`, you can also just type `cd` and drag the folder into Terminal.
4. Run `cp .env.sample .env` to create a new .env file.
5. Open the .env file and fill in the `COINGECKO_PRO_API_KEY` and `RPC_URL` fields. Ask your team for the values.
4. Run the script with `yarn start --address <address1> [--address <address2>] --csv output/result.csv` (address can be a pool, wallet, position or position mint).
6. Analyze the positions in the summary csv file in `output` folder
5. All done!

### What the script is actually doing

1. The script loads all transactions associated with the entered addresses and decodes all transactions related to whirlpool positions.
2. For each position found in the transactions, go through each transaction instruction (from oldest to newest) using a rolling window that keeps track of deposits and withdrawals throughout the history of the position.
3. Calculate the value of the deposited and withdrawn tokens at the time of the action and aggregate them into a position summary.
4. Calculate the raw profit of the position by subtracting the total value of the deposited tokens from the total value of the withdrawn tokens.
5. Calculate the forgone profit of the position by subtracting the total value of the deposited tokens from the value of those same tokens at withdrawing.
6. Calculate the opportunity cost of the position by subtracting the forgone profit from the raw profit.

### Summary columns

An explanation of each field in the summary csv file can be found in the `src/analyze-position.ts` file.

### Known limitations

* This script uses coingecko historic token prices at hourly resolution. This means that for particularly volatile pairs the price used for calculating the profitability might not always match the exact price at opening/closing of a position. Furthermore, for prices older than 90 days the coingecko api only returns prices with daily resolution. This makes the calculations for positions older than 90 days less reliable.
* This script reads back onchain transaction data 1000 signatures at a time which can be rather slow when analyzing a lot of wallets or when doing a lot of 1000 signature cycles. Since the script is currently set up to keep all transactions in memory there is a chance of running out of system memory. With 16Gb RAM the limit seems to be around 100k transactions.
* To be able to analyze a position you will either need to have a wallet address or position address. There is a `find` subcommand that can be used to find wallets with open positions for a given pool but there is no way to find historic/closed positions. This makes it impossible to find closed positions unless you know the wallet or position address.
* For a position to be included in the calculation the transaction that opens the position needs to be present which then assumes all other transactions related to the position are present given they happened after the open position transaction. There are edge cases (like when a position nft is transfered) where a position's transactions might not all be present which can give an inaccurate result.

