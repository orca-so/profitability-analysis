#!/usr/bin/env node

import {
  err,
  info,
  linkAddress,
  setLoadingText,
  startLoading,
  stopLoading,
} from "./logger";
import { logPositionSummaries, writePositionSummaries } from "./write-csv";
import { args } from "./arguments";
import { gatherInstructions } from "./gather-instructions";
import { decodeTransactions } from "./decode-transaction";
import { analyzePositions, getPositionValues } from "./analyze-position";
import { fetchPositionsForInstructions } from "./position-fetcher";
import { fetchPoolsForInstructions } from "./pool-fetcher";
import { fetchAndBuildCoinIdToMintMap, fetchPricesForInstructions, fetchPricesForPositions } from "./price-fetcher";
import { logLiquidityProviderAggregates, logSummaryAggregates } from "./aggregate";
import { homedir } from "os";
import invariant from "tiny-invariant";
import { gatherPositions } from "./gather-positions";
import { fetchPositionOwners } from "./owner-fetcher";
import { computeWalletValues } from "./analyze-wallet";
import { fetchTokensForPools, fetchTokensForPositions } from "./token-fetcher";

async function analyze() {
  invariant(args.command === "analyze");
  const addresses = new Set(args.address.map((address) => address.toString()));
  const linkedAddresses = linkAddress(...addresses);

  setLoadingText(`Fetching recent transactions for ${linkedAddresses}`);
  const transactionInstructions = await gatherInstructions(Array.from(addresses), args.cycles);

  setLoadingText(`Decoding recent transactions for ${linkedAddresses}`);
  const positionInstructions = decodeTransactions(Array.from(transactionInstructions.values()));

  setLoadingText(`Fetching required position data for ${linkedAddresses}`);
  const positionMap = await fetchPositionsForInstructions(positionInstructions);

  setLoadingText(`Fetching required pool data for ${linkedAddresses}`);
  const poolMap = await fetchPoolsForInstructions(positionInstructions);

  setLoadingText(`Fetching required token data for ${linkedAddresses}`);
  const tokenMap = await fetchTokensForPools(Array.from(poolMap.values()));

  setLoadingText(`Fetching required price data for ${linkedAddresses}`);
  const priceMap = await fetchPricesForInstructions(positionInstructions);

  setLoadingText(`Analyzing positions for ${linkedAddresses}`);
  let summaries = analyzePositions(Array.from(positionInstructions.values()), positionMap, poolMap, tokenMap, priceMap);
  if (!args.includeOpen) {
    summaries = summaries.filter((summary) => summary.closedAt);
  }

  setLoadingText(`Logging summaries for ${linkedAddresses}`);
  logPositionSummaries(summaries);
  logSummaryAggregates(summaries, args.summary);
  if (args.csv) {
    const filePath = args.csv.replace("~", homedir)
    await writePositionSummaries(summaries, filePath);
  }
}

async function find() {
  invariant(args.command === "find");
  const logPool = args.pool ? `for ${linkAddress(args.pool)}` : "";

  setLoadingText(`Finding all positions ${logPool}`);
  const positions = await gatherPositions(args.pool, args.includeOutOfRange);

  setLoadingText(`Fetching required token data for ${logPool}`);
  const tokenMap = await fetchTokensForPositions(Array.from(positions.values()));

  setLoadingText(`Fetching required price data ${logPool}`);
  const priceMap = await fetchPricesForPositions(Array.from(positions.values()));

  setLoadingText(`Computing position values ${logPool}`);
  const positionValues = getPositionValues(positions, args.min, args.max, tokenMap, priceMap);

  setLoadingText(`Finding wallet addresses ${logPool}`);
  const ownerMap = await fetchPositionOwners(positions, positionValues, args.count);

  setLoadingText(`Computing outstanding balances ${logPool}`);
  const walletValues = computeWalletValues(positions, ownerMap, positionValues);

  setLoadingText(`Logging LPs ${logPool}`);
  if (args.asParams) {
    const addresses = Array.from(walletValues.keys()).map(wallet => wallet.toString());
    const params = addresses.map(address => `--address ${address}`).join(" ");
    info(`pnl ${params}`);
  } else {
    logLiquidityProviderAggregates(walletValues);
  }
}

async function run() {
  startLoading("Fetching token price metadata");
  await fetchAndBuildCoinIdToMintMap();

  switch (args.command) {
    case "analyze":
      return await analyze();
    case "find":
      return await find();
  }
}

run().catch(err).finally(stopLoading);
