import type { Position, WhirlpoolData } from "@orca-so/whirlpools-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import type { Token } from "@orca-so/token-sdk";
import { debug } from "./logger";
import { PublicKey } from "@solana/web3.js";
import { TokenFetcher, MetaplexProvider } from "@orca-so/token-sdk";
import { connection } from "./globals";
import type { Whirlpool } from "@orca-so/whirlpools-sdk";

export const tokenFetcher = new TokenFetcher(connection, 3000).addProvider(
  new MetaplexProvider(connection, { loadImage: false }),
);

export async function fetchTokensForPools(pool: Whirlpool[]): Promise<ReadonlyMap<string, Token>> {
  return fetchTokensForPoolData(pool.map((pool) => pool.getData()));
}

export async function fetchTokensForPositions(positions: Position[]): Promise<ReadonlyMap<string, Token>> {
  return fetchTokensForPoolData(positions.map((position) => position.getWhirlpoolData()));
}

export async function fetchTokensForPoolData(poolData: WhirlpoolData[]): Promise<ReadonlyMap<string, Token>> {
  const tokenFetchSet = computeTokenFetchSet(poolData);
  const tokenMap = await tokenFetcher.findMany(Array.from(tokenFetchSet));
  debug(
    "Fetched information for",
    tokenMap.size,
    tokenMap.size === 1 ? "token" : "tokens"
  );
  return tokenMap;
}

export function computeTokenFetchSet(pools: WhirlpoolData[]): ReadonlySet<string> {
  return new Set(
    pools.flatMap((pool) => [
      NATIVE_MINT.toBase58(),
      pool.tokenMintA.toBase58(),
      pool.tokenMintB.toBase58(),
      ...pool.rewardInfos.map((info) => info.mint.toBase58()),
    ]).filter((key) => key !== PublicKey.default.toString()),
  );
}
