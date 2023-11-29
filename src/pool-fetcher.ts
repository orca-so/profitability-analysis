import type { Whirlpool } from "@orca-so/whirlpools-sdk";
import { PREFER_CACHE } from "@orca-so/whirlpools-sdk";
import { whirlpoolClient } from "./globals";
import type { DecodedInstruction } from "./decode-transaction";
import { debug } from "./logger";

export async function fetchPoolsForInstructions(
  instructions: Map<string, DecodedInstruction[]>,
): Promise<ReadonlyMap<string, Whirlpool>> {
  const flatInstructions = Array.from(instructions.values()).flat();
  const poolFetchSet = new Set(flatInstructions.flatMap((instruction) => {
    if ("whirlpool" in instruction) {
      return [instruction.whirlpool.toString()];
    }
    return [];
  }));
  const pools = await whirlpoolClient.getPools(Array.from(poolFetchSet), PREFER_CACHE);
  const poolMap = new Map(pools.map((pool) => [pool.getAddress().toBase58(), pool]));
  debug(
    "Fetched account data for",
    poolMap.size,
    poolMap.size === 1 ? "whirlpool" : "whirlpools"
  );
  return poolMap;
}
