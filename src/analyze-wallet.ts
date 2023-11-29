import type { Position } from "@orca-so/whirlpools-sdk";
import type { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";

export function computeWalletValues(
  positions: Position[],
  ownerMap: ReadonlyMap<string, PublicKey>,
  positionValues: ReadonlyMap<string, Decimal>,
) {
  return positions.reduce((acc, position) => {
    const owner = ownerMap.get(position.getAddress().toString());
    const value = positionValues.get(position.getAddress().toString());
    if (owner && value) {
      const current = acc.get(owner.toBase58()) ?? new Decimal(0);
      acc.set(owner.toBase58(), Decimal.max(current, value));
    }
    return acc;
  }, new Map<string, Decimal>());
}
