import Decimal from "decimal.js";
import { coingecko, getCoinsListRequest, getHistoricalPriceRequest } from "./coingecko-api";
import invariant from "tiny-invariant";
import type { DecodedInstruction } from "./decode-transaction";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { debug, linkAddress, warn } from "./logger";
import type { Address } from "@orca-so/common-sdk";
import PQueue from "p-queue";
import type { Position } from "@orca-so/whirlpools-sdk";

const HALF_HOUR = 1800;
const HOUR = 3600;
const HALF_DAY = 43200;
const DAY = 86400;

const coinIdToMintMap = new Map<string, string>()
const mintToCoinIdMap = new Map<string, string>()

export async function fetchAndBuildCoinIdToMintMap() {
  const request = getCoinsListRequest();
  const res = await coingecko.request(request);

  invariant(res.status === 200, "Error fetching coin list from coingecko");

  const json = (await res.data) as { id: string; platforms: Record<string, string> }[];

  const coinIds = json
    .map((coin) => ({
      id: coin.id,
      platforms: coin.platforms,
    }))
    .filter(coin => coin.platforms?.["solana"]);

  debug("Found", coinIds.length, coinIds.length === 1 ? "token" : "tokens", "on CoinGecko for the Solana chain");

  coinIds.forEach((coin) => {
    const mint = coin.platforms["solana"];
    coinIdToMintMap.set(mint, coin.id);
    mintToCoinIdMap.set(coin.id, mint);
  });
}

export async function fetchPrices(keys: string[]) {
  const queue = new PQueue({ concurrency: 10, interval: 200 });

  const ranges = new Map<string, number[]>();
  for (const key of keys) {
    const [mint, blockTime] = splitPriceKey(key);
    const blockTimes = ranges.get(mint) ?? [];
    ranges.set(mint, [...blockTimes, blockTime]);
  }

  const historicalPrices = new Map<string, Map<number, number>>();
  await queue.addAll(
    Array.from(ranges.entries()).map(([mint, blockTimes]) => async () => {
      try {
        const prices = await fetchHistoricalPriceBatched(mint, blockTimes);
        historicalPrices.set(mint, prices);
      } catch (e) {
        warn("Failed to fetch price for mint", linkAddress(mint), e);
      }
    }),
  );

  const priceMap = new Map<string, Decimal>();
  for (const key of keys) {
    const [mint, blockTime] = splitPriceKey(key);
    const roundedBlockTime = roundToNearest(blockTime, HOUR);
    const prices = historicalPrices.get(mint);
    if (prices && prices.size > 0) {
      const price = prices.get(roundedBlockTime);
      invariant(price, `No price found for ${linkAddress(mint)} at ${roundedBlockTime}`);
      priceMap.set(key, new Decimal(price));
    }
  }

  debug("Fetched", priceMap.size, "token", priceMap.size === 1 ? "price" : "prices", "from CoinGecko");
  return priceMap;
}

async function fetchHistoricalPriceBatched(mint: string, blockTimes: number[]) {
  const min = roundToNearest(Math.min(...blockTimes) - HALF_DAY, DAY);
  const max = roundToNearest(Math.max(...blockTimes) + HALF_DAY, DAY);

  const prices = new Map<number, number>();
  const cutoffTime = Math.round(Date.now() / 1000) - 90 * DAY;

  // Create batches of 60 days to maintain hourly resolution.
  // Start with an inital batch from [start..<90DaysAgo] if needed
  // because resoltion is daily anyway for older than 90 days.

  let start = min;
  while (start < max) {
    const olderThan90Days = start < cutoffTime;
    const end = olderThan90Days ? cutoffTime : Math.min(start + DAY * 60, max);
    const batch = await fetchHistoricalPrice(mint, start, end);
    for (const [blockTime, price] of batch.entries()) {
      prices.set(blockTime, price);
    }
    start = end;
  }

  // Fill in missing prices by copying the previous (or next) price

  for (let i = min; i <= max; i += HOUR) {
    if (!prices.has(i)) {
      const price = prices.get(i - HOUR);
      if (price) {
        prices.set(i, price);
      }
    }
  }

  for (let i = max; i >= min; i -= HOUR) {
    if (!prices.has(i)) {
      const price = prices.get(i + HOUR);
      if (price) {
        prices.set(i, price);
      }
    }
  }

  return prices;
}

async function fetchHistoricalPrice(mint: string, start: number, end: number) {
  invariant(end - start > HALF_HOUR, "Price range too small");

  const coinId = coinIdToMintMap.get(mint);
  invariant(coinId, "No coin id found");

  const request = getHistoricalPriceRequest(coinId, start, end);
  const res = await coingecko.request(request);

  invariant(res.status === 200, "Error fetching historical prices");

  const json = (await res.data) as {
    prices: [number, number][];
  };

  // prices are in miliseconds and we round them to the nearest hour
  const priceMap = new Map(json.prices.map(([time, price]) =>
    [roundToNearest(time / 1000, HOUR), price]
  ));

  return priceMap;
}

export async function fetchPricesForPositions(
  pools: Position[],
): Promise<ReadonlyMap<string, Decimal>> {
  const priceFetchSet = new Set(pools.flatMap((pool) => [
    NATIVE_MINT.toString(),
    pool.getWhirlpoolData().tokenMintA.toString(),
    pool.getWhirlpoolData().tokenMintB.toString(),
    ...pool.getWhirlpoolData().rewardInfos
      .filter(rewardInfo => !rewardInfo.mint.equals(PublicKey.default))
      .map(rewardInfo => rewardInfo.mint.toString()),
  ]));
  const priceMap = await fetchPrices(Array.from(priceFetchSet));
  return priceMap;
}

export async function fetchPricesForInstructions(
  instructions: Map<string, DecodedInstruction[]>,
): Promise<ReadonlyMap<string, Decimal>> {
  const flatInstructions = Array.from(instructions.values()).flat();
  const priceFetchSet = computePriceFetchSet(flatInstructions);
  const priceMap = await fetchPrices(Array.from(priceFetchSet));
  return priceMap;
}

function computePriceFetchSet(instructions: DecodedInstruction[]): ReadonlySet<string> {
  const timedPriceFetchSet = new Set(
    instructions.flatMap((instruction) => {
      const keys: string[] = [priceKey(NATIVE_MINT, instruction.blockTime)];
      if ("tokenAMint" in instruction) {
        keys.push(priceKey(instruction.tokenAMint, instruction.blockTime));
      }
      if ("tokenBMint" in instruction) {
        keys.push(priceKey(instruction.tokenBMint, instruction.blockTime));
      }
      if ("rewardMint" in instruction && !instruction.rewardMint.equals(PublicKey.default)) {
        keys.push(priceKey(instruction.rewardMint, instruction.blockTime));
      }
      return keys;
    }),
  );
  const currentPriceFetchSet = new Set(
    Array.from(timedPriceFetchSet).map((key) => key.split(":")[0]),
  );
  return new Set([...timedPriceFetchSet, ...currentPriceFetchSet]);
}

export function priceKey(mint: Address, time?: number) {
  if (!time) {
    return mint.toString();
  }
  return `${mint.toString()}:${time}`;
}

export function splitPriceKey(key: string) {
  const parts = key.split(":");
  const mint = parts[0];
  const blockTime = parts.length > 1
    ? parseInt(parts[1])
    : Math.floor(Date.now() / 1000);
  return [mint, blockTime] as [string, number]
}

function roundToNearest(time: number, interval: number) {
  return Math.round(time / interval) * interval;
}

export function convertToUiAmount(amount: BN, decimals: number) {
  return new Decimal(amount.toString()).dividedBy(10 ** decimals);
}

export function convertToRawAmount(amount: Decimal, decimals: number) {
  return new BN(amount.times(10 ** decimals).toString());
}
