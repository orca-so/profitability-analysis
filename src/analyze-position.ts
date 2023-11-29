import Decimal from "decimal.js";
import type { DecodedInstruction } from "./decode-transaction";
import { PublicKey } from "@solana/web3.js";
import invariant from "tiny-invariant";
import type { Whirlpool, Position, WhirlpoolData } from "@orca-so/whirlpools-sdk";
import {
  collectFeesQuote,
  decreaseLiquidityQuoteByLiquidityWithParams,
  collectRewardsQuote,
} from "@orca-so/whirlpools-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { CLOSE_TRANSACTION_LAMPORTS, RECLAIMABLE_RENT_LAMPORTS } from "./globals";
import { BN } from "bn.js";
import { Percentage } from "@orca-so/common-sdk";
import type { Token } from "@orca-so/token-sdk";
import { priceKey, convertToUiAmount } from "./price-fetcher";
import { debug, linkAddress, warn } from "./logger";

export interface PositionSummary {
  /*
    The position's pool address.
  */
  whirlpool: PublicKey;

  /*
    The position account address. If the position
    is closed then this account will not have any
    data associated with it.
  */
  position: PublicKey;

  /*
    The token mint address for the position.
  */
  positionMint: PublicKey;

  /*
    The account that is authorized to take actions
    on the position.
  */
  owner: PublicKey;

  /*
    The unix timestamp of when the position was opened.
  */
  openedAt: number;

  /*
    The unix timestamp of when the position was closed.
    Can be undefined if the position is still open.
  */
  closedAt: number | undefined;

  /*
    The sum of the usd values of all the
    tokenA and tokenB deposited into the pool
    at the point of depositing.
  */
  depositedValue: Decimal;

  /*
    Estimate of the position size in usd calculated
    using the maximum of depositedValue minus withdrawnValue
    at any point in the history of the position.
  */
  positionSize: Decimal;

  /*
    The sum of the usd values of the total amount of
    tokenA and tokenB withdrawn from the pool
    at the point of withdrawing.
  */
  withdrawnValue: Decimal;

  /*
    The sum of the usd values of all the
    tokenA and tokenB deposited into the pool
    at the point of withdrawing.
  */
  forgoneValue: Decimal;

  /*
    The total usd value of all fees collected
    from the position.
  */
  collectedFeesValue: Decimal;

  /*
    The total usd value of all rewards collected
    from the position.
  */
  collectedRewardsValue: Decimal;

  /*
    The total usd value of transaction fees
    paid for the position.
  */
  transactionCost: Decimal;

  /*
    The outstanding usd value of the rent paid and reclaimed for the position.
  */
  paidRent: Decimal;

  /*
    The current usd value of tokenA and tokenB
    in the position.
  */
  currentValue: Decimal;

  /*
    The current usd value of the total amount of
    tokenA fees and tokenB fees that is currently
    harvestable from the position.
  */
  collectibleFeesValue: Decimal;

  /*
    The current usd value of all the reward tokens
    currently collecitble from the position.
  */
  collectibleRewardsValue: Decimal;

  /*
    Reclaimable rent is the usd value of amount of
    lamports that can be reclaimed from the position
    when it is closed minus the amount of lamports
    that is needed to close the position.
  */
  reclaimableRent: Decimal;

  /*
    The usd value of the profit from the position.
    Can be unrealized if the position is still open.
  */
  profit: Decimal;

  /*
    The profit ratio of the position. Calculated
    as the profit divided by the position size.
  */
  profitRatio: Decimal;

  /*
    The forgone profit for the position. Calculated
    as the difference between the forgone value and
    the deposit value.
  */
  forgoneProfit: Decimal;

  /*
    The forgone profit ratio for the position.
    Calculated as the forgone profit divided by
    the position size.
  */
  forgoneProfitRatio: Decimal;

  /*
    The opportunity cost of the position. This is the
    difference between the profit and the forgone
    profit. If this value is negative, then the position
    is more profitable than not having opened the position
    and just holding the tokens.
  */
  opportunityCost: Decimal;

  /*
    The difference between the forgone profit ratio and profit ratio.
    This is a measure of how much more profitable the position
    is than not having opened the position and just holding
    the tokens.
  */
  opportunityCostRatio: Decimal;
}

export function analyzePositions(
  position: DecodedInstruction[][],
  positionMap: ReadonlyMap<string, Position>,
  poolMap: ReadonlyMap<string, Whirlpool>,
  tokenMap: ReadonlyMap<string, Token>,
  priceMap: ReadonlyMap<string, Decimal>,
): PositionSummary[] {
  const summaries = position.flatMap((instructions) => {
    try {
      return [analyzePosition(instructions, positionMap, poolMap, tokenMap, priceMap)]
    } catch (e) {
      const address = instructions.find((instruction) => "position" in instruction)?.position;
      if (address) {
        warn("Failed to analyze position", linkAddress(address), e);
      }
      return [];
    }
  }
  );
  debug("Analyzed instructions for", summaries.length, summaries.length === 1 ? "position" : "positions");
  return summaries;
}

export function getPositionValues(
  positions: Position[],
  minimumValue: number | undefined,
  maximumValue: number | undefined,
  tokenMap: ReadonlyMap<string, Token>,
  priceMap: ReadonlyMap<string, Decimal>,
) {
  return positions.reduce((acc, position) => {
    try {
      const pool = position.getWhirlpoolData();
      const { currentValue } = getOutstandingBalances(position, pool, tokenMap, priceMap);
      const meetsMinimumValue = !minimumValue || currentValue.gte(minimumValue);
      const meetsMaximumValue = !maximumValue || currentValue.lt(maximumValue);
      if (meetsMinimumValue && meetsMaximumValue) {
        acc.set(position.getAddress().toString(), currentValue);
      }
    } catch (e) {
      warn("Failed to get position value for", linkAddress(position.getAddress()), e);
    }
    return acc;
  }, new Map<string, Decimal>());
}

export function analyzePosition(
  instructions: DecodedInstruction[],
  positionMap: ReadonlyMap<string, Position>,
  poolMap: ReadonlyMap<string, Whirlpool>,
  tokenMap: ReadonlyMap<string, Token>,
  priceMap: ReadonlyMap<string, Decimal>,
): PositionSummary {
  const openInstructions = instructions.filter(
    (instruction) => instruction.type === "openPosition",
  );
  invariant(openInstructions.length === 1, "No open instruction found.");
  const openInstruction = openInstructions[0];
  invariant(
    openInstruction.type === "openPosition",
    "Open instruction is not an open instruction.",
  );

  const closePositions = instructions.filter((instruction) => instruction.type === "closePosition");
  invariant(closePositions.length <= 1, "More than one close instruction found.");
  const closeInstruction = closePositions.length === 1 ? closePositions[0] : undefined;

  const whirlpool = poolMap.get(openInstruction.whirlpool.toString());
  invariant(whirlpool, "Pool not found");

  const position = positionMap.get(openInstruction.position.toString());

  const analyzedInstructions = analyzeInstructions(instructions, whirlpool, tokenMap, priceMap);

  const {
    depositedValue,
    withdrawnValue,
    positionSize,
    forgoneValue,
    collectedFeesValue,
    collectedRewardsValue,
    transactionCost,
    paidRent,
  } = analyzedInstructions;

  invariant(depositedValue.gte(1), "Deposited value to small to accurately analyze");

  const positionBalance = getOutstandingBalances(position, whirlpool.getData(), tokenMap, priceMap);

  const { currentValue, collectibleFeesValue, collectibleRewardsValue, reclaimableRent } = positionBalance;

  const gains = withdrawnValue
    .plus(currentValue)
    .plus(collectedFeesValue)
    .plus(collectedRewardsValue)
    .plus(collectibleFeesValue)
    .plus(collectibleRewardsValue)
    .plus(reclaimableRent)

  const losses = depositedValue
    .plus(transactionCost)
    .plus(paidRent);

  const profit = gains.minus(losses);

  const profitRatio = profit.div(positionSize);
  const forgoneProfit = forgoneValue.minus(depositedValue);
  const forgoneProfitRatio = forgoneProfit.div(positionSize);
  const opportunityCost = forgoneProfit.minus(profit);
  const opportunityCostRatio = opportunityCost.neg().div(positionSize);

  return {
    whirlpool: new PublicKey(openInstruction.whirlpool),
    position: new PublicKey(openInstruction.position),
    positionMint: new PublicKey(openInstruction.positionMint.toString()),
    owner: new PublicKey(openInstruction.owner.toString()),
    openedAt: openInstruction.blockTime,
    closedAt: closeInstruction?.blockTime,
    ...analyzedInstructions,
    ...positionBalance,
    profit,
    profitRatio,
    forgoneProfit,
    forgoneProfitRatio,
    opportunityCost,
    opportunityCostRatio,
  };
}

export function analyzeInstructions(
  instructions: DecodedInstruction[],
  whirlpool: Whirlpool,
  tokenMap: ReadonlyMap<string, Token>,
  priceMap: ReadonlyMap<string, Decimal>,
): Pick<
  PositionSummary,
  | "depositedValue"
  | "withdrawnValue"
  | "positionSize"
  | "forgoneValue"
  | "collectedFeesValue"
  | "collectedRewardsValue"
  | "paidRent"
  | "transactionCost"
> {
  const sortedInstructions = instructions.sort((a, b) => a.blockTime - b.blockTime);
  let rollingTokenAAmount = new Decimal(0);
  let rollingTokenBAmount = new Decimal(0);
  let totalLiquidity = new BN(0);
  const transactionCosts = new Map<string, Decimal>();

  let depositedValue = new Decimal(0);
  let withdrawnValue = new Decimal(0);
  let forgoneValue = new Decimal(0);
  let positionSize = new Decimal(0);
  let collectedFeesValue = new Decimal(0);
  let collectedRewardsValue = new Decimal(0);
  let paidRent = new Decimal(0);

  const whirlpoolData = whirlpool.getData();

  const solToken = tokenMap.get(NATIVE_MINT.toBase58());
  invariant(solToken, "SOL token not found");
  const tokenA = tokenMap.get(whirlpoolData.tokenMintA.toBase58());
  invariant(tokenA, "Token A not found");
  const tokenB = tokenMap.get(whirlpoolData.tokenMintB.toBase58());
  invariant(tokenB, "Token B not found");

  for (const instruction of sortedInstructions) {
    const solPrice = priceMap.get(priceKey(NATIVE_MINT, instruction.blockTime));
    invariant(solPrice, `SOL price not found at ${instruction.blockTime}`);
    const tokenAPrice = priceMap.get(priceKey(tokenA.mint, instruction.blockTime));
    invariant(tokenAPrice, `Token A price not found at ${instruction.blockTime}`);
    const tokenBPrice = priceMap.get(priceKey(tokenB.mint, instruction.blockTime));
    invariant(tokenBPrice, `Token B price not found at ${instruction.blockTime}`);

    const transactionFee = convertToUiAmount(
      new BN(instruction.transactionFee),
      solToken.decimals,
    ).mul(solPrice);
    transactionCosts.set(instruction.signature, transactionFee);

    switch (instruction.type) {
      case "openPosition":
        const rentFee = convertToUiAmount(new BN(instruction.rentFee), solToken.decimals).mul(
          solPrice,
        );

        paidRent = paidRent.add(rentFee);
        break;
      case "increaseLiquidity":
        const tokenAAmount = convertToUiAmount(new BN(instruction.tokenAIn), tokenA.decimals);
        rollingTokenAAmount = rollingTokenAAmount.add(tokenAAmount);
        const tokenAInValue = tokenAAmount.mul(tokenAPrice);

        const tokenBAmount = convertToUiAmount(new BN(instruction.tokenBIn), tokenB.decimals);
        rollingTokenBAmount = rollingTokenBAmount.add(tokenBAmount);
        const tokenBInValue = tokenBAmount.mul(tokenBPrice);

        depositedValue = depositedValue.add(tokenAInValue).add(tokenBInValue);
        totalLiquidity = totalLiquidity.add(instruction.liquidityIn);
        positionSize = Decimal.max(positionSize, depositedValue.minus(withdrawnValue));
        break;
      case "decreaseLiquidity":
        const tokenAOutValue = convertToUiAmount(
          new BN(instruction.tokenAOut),
          tokenA.decimals,
        ).mul(tokenAPrice);

        const tokenBOutValue = convertToUiAmount(
          new BN(instruction.tokenBOut),
          tokenB.decimals,
        ).mul(tokenBPrice);

        withdrawnValue = withdrawnValue.add(tokenAOutValue).add(tokenBOutValue);

        const withdrawnPercentage = new Decimal(instruction.liquidityOut.toString()).div(
          new Decimal(totalLiquidity.toString()),
        );
        const partialTokenAAmount = rollingTokenAAmount.mul(withdrawnPercentage);
        const partialTokenBAmount = rollingTokenBAmount.mul(withdrawnPercentage);

        rollingTokenBAmount = rollingTokenBAmount.sub(partialTokenBAmount);
        rollingTokenAAmount = rollingTokenAAmount.sub(partialTokenAAmount);

        const partialForgoneValue = [
          partialTokenAAmount.mul(tokenAPrice),
          partialTokenBAmount.mul(tokenBPrice),
        ].reduce((acc, curr) => acc.add(curr), new Decimal(0));

        forgoneValue = forgoneValue.add(partialForgoneValue);
        totalLiquidity = totalLiquidity.sub(instruction.liquidityOut);
        break;
      case "collectFees":
        const tokenAFeeValue = convertToUiAmount(
          new BN(instruction.tokenAFee),
          tokenA.decimals,
        ).mul(tokenAPrice);

        const tokenBFeeValue = convertToUiAmount(
          new BN(instruction.tokenBFee),
          tokenB.decimals,
        ).mul(tokenBPrice);

        collectedFeesValue = collectedFeesValue.add(tokenAFeeValue).add(tokenBFeeValue);
        break;
      case "collectReward":
        const rewardToken = tokenMap.get(instruction.rewardMint.toString());
        invariant(rewardToken, "Reward token not found");

        const rewardTokenPrice = priceMap.get(priceKey(rewardToken.mint, instruction.blockTime));
        invariant(rewardTokenPrice, "Reward token price not found");

        const rewardValue = convertToUiAmount(
          new BN(instruction.rewardAmount),
          rewardToken.decimals,
        ).mul(rewardTokenPrice);

        collectedRewardsValue = collectedRewardsValue.add(rewardValue);
        break;
      case "closePosition":
        const reclaimedRent = convertToUiAmount(
          new BN(instruction.reclaimedRent),
          solToken.decimals,
        ).mul(solPrice);

        paidRent = paidRent.sub(reclaimedRent);
        break;
    }
  }

  const currentTokenAPrice = priceMap.get(tokenA.mint.toString());
  invariant(currentTokenAPrice, "Current token A price not found");
  const currentTokenBPrice = priceMap.get(tokenB.mint.toString());
  invariant(currentTokenBPrice, "Current token B price not found");

  const remainingForgoneValue = [
    rollingTokenAAmount.mul(currentTokenAPrice),
    rollingTokenBAmount.mul(currentTokenBPrice),
  ].reduce((acc, curr) => acc.add(curr), new Decimal(0));
  forgoneValue = forgoneValue.add(remainingForgoneValue);

  const transactionCost = Array.from(transactionCosts.values()).reduce(
    (acc, fee) => acc.plus(fee),
    new Decimal(0),
  );

  return {
    depositedValue,
    withdrawnValue,
    forgoneValue,
    positionSize,
    collectedFeesValue,
    collectedRewardsValue,
    paidRent,
    transactionCost,
  };
}

export function getOutstandingBalances(
  position: Position | undefined,
  whirlPool: WhirlpoolData,
  tokenMap: ReadonlyMap<string, Token>,
  priceMap: ReadonlyMap<string, Decimal>,
): Pick<
  PositionSummary,
  "currentValue" | "collectibleFeesValue" | "collectibleRewardsValue" | "reclaimableRent"
> {
  if (!position) {
    // position not found. Consider it closed
    return {
      currentValue: new Decimal(0),
      collectibleFeesValue: new Decimal(0),
      collectibleRewardsValue: new Decimal(0),
      reclaimableRent: new Decimal(0),
    };
  }

  const positionData = position.getData();

  const whirlpoolData = position.getWhirlpoolData();
  const tickLower = position.getLowerTickData();
  const tickUpper = position.getUpperTickData();

  const solToken = tokenMap.get(NATIVE_MINT.toBase58());
  invariant(solToken, "SOL token not found");
  const tokenA = tokenMap.get(whirlpoolData.tokenMintA.toBase58());
  invariant(tokenA, "Token A not found");
  const tokenB = tokenMap.get(whirlpoolData.tokenMintB.toBase58());
  invariant(tokenB, "Token B not found");

  const solPrice = priceMap.get(NATIVE_MINT.toBase58());
  invariant(solPrice, "Current SOL price not found");
  const tokenAPrice = priceMap.get(tokenA.mint.toString());
  invariant(tokenAPrice, "Current Token A price not found");
  const tokenBPrice = priceMap.get(tokenB.mint.toString());
  invariant(tokenBPrice, "Current Token B price not found");

  const currentTokenSumQuote = decreaseLiquidityQuoteByLiquidityWithParams({
    liquidity: positionData.liquidity,
    tickLowerIndex: positionData.tickLowerIndex,
    tickUpperIndex: positionData.tickUpperIndex,
    sqrtPrice: whirlpoolData.sqrtPrice,
    tickCurrentIndex: whirlpoolData.tickCurrentIndex,
    slippageTolerance: Percentage.fromDecimal(new Decimal(0)),
  });

  const tokenAAmount = convertToUiAmount(
    new BN(currentTokenSumQuote.tokenEstA.toString()),
    tokenA.decimals,
  );

  const tokenBAmount = convertToUiAmount(
    new BN(currentTokenSumQuote.tokenEstB.toString()),
    tokenB.decimals,
  );

  const currentValue = [tokenAAmount.mul(tokenAPrice), tokenBAmount.mul(tokenBPrice)].reduce(
    (acc, curr) => acc.add(curr),
    new Decimal(0),
  );

  const outstandingFeeQuote = collectFeesQuote({
    whirlpool: whirlpoolData,
    position: positionData,
    tickLower,
    tickUpper,
  });

  const tokenAFeeAmount = convertToUiAmount(
    new BN(outstandingFeeQuote.feeOwedA.toString()),
    tokenA.decimals,
  );

  const tokenBFeeAmount = convertToUiAmount(
    new BN(outstandingFeeQuote.feeOwedB.toString()),
    tokenB.decimals,
  );

  const collectibleFeesValue = [
    tokenAFeeAmount.mul(tokenAPrice),
    tokenBFeeAmount.mul(tokenBPrice),
  ].reduce((acc, curr) => acc.add(curr), new Decimal(0));

  const oustandingRewardQuote = collectRewardsQuote({
    whirlpool: whirlpoolData,
    position: positionData,
    tickLower,
    tickUpper,
  });

  const collectibleRewardsValue = whirlPool.rewardInfos
    .map((rewardInfo, index) => {
      const rewardAmount = oustandingRewardQuote[index];
      const token = tokenMap.get(rewardInfo.mint.toString());
      const price = priceMap.get(rewardInfo.mint.toString());
      if (rewardAmount && token && price) {
        const rewardUiAmount = convertToUiAmount(new BN(rewardAmount.toString()), token.decimals);
        return rewardUiAmount.mul(price);
      } else {
        return new Decimal(0);
      }
    })
    .reduce((acc, curr) => acc.add(curr), new Decimal(0));

  const reclaimableRent = convertToUiAmount(
    RECLAIMABLE_RENT_LAMPORTS.sub(CLOSE_TRANSACTION_LAMPORTS),
    solToken.decimals,
  ).mul(solPrice);

  return {
    currentValue,
    collectibleFeesValue,
    collectibleRewardsValue,
    reclaimableRent,
  };
}
