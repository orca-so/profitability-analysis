import type { Position } from "@orca-so/whirlpools-sdk";
import type { DecodedInstruction } from "./decode-transaction";
import { whirlpoolClient } from "./globals";
import { debug } from "./logger";

export async function fetchPositionsForInstructions(
  instructions: Map<string, DecodedInstruction[]>,
): Promise<ReadonlyMap<string, Position>> {
  const flatInstructions = Array.from(instructions.values()).flat();
  const positionFetchSet = new Set(flatInstructions.map((instruction) => instruction.position.toString()));
  const positions = await whirlpoolClient.getPositions(Array.from(positionFetchSet));
  const positionMap = new Map(
    Object.entries(positions).flatMap(([key, value]) => (value ? [[key, value]] : [])),
  );
  debug(
    "Fetched",
    positionMap.size,
    "open position",
    positionMap.size === 1 ? "account" : "accounts"
  );
  return positionMap;
}
