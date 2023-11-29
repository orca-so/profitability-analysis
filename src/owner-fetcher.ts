import type { Position } from "@orca-so/whirlpools-sdk";
import PQueue from "p-queue";
import { debug, linkAddress, warn } from "./logger";
import type { PublicKey } from "@solana/web3.js";
import { ParsableTokenAccountInfo } from "@orca-so/common-sdk";
import { connection } from "./globals";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import invariant from "tiny-invariant";
import type Decimal from "decimal.js";

export async function fetchPositionOwners(
  positions: Position[],
  positionValues: ReadonlyMap<string, Decimal>,
  maximumCount?: number,
): Promise<ReadonlyMap<string, PublicKey>> {
  const queue = new PQueue({ concurrency: 10, interval: 200 });
  const ownerMap = new Map<string, PublicKey>();
  const ownerSet = new Set<string>();

  await queue.addAll(
    positions.map((position) => async () => {
      try {
        const value = positionValues.get(position.getAddress().toString());
        if (!value || maximumCount && ownerSet.size >= maximumCount) {
          return;
        }
        const owner = await getPositionWallet(position);
        ownerMap.set(position.getAddress().toString(), owner);
        ownerSet.add(owner.toString());
      } catch (e) {
        warn("Failed to fetch position owner for", linkAddress(position.getAddress()), e)
      }
    }),
  );

  debug(
    "Fetched",
    ownerMap.size,
    ownerMap.size === 1 ? "owner" : "owners",
    "for positions",
  );

  return ownerMap;
}

async function getPositionWallet(
  position: Position
): Promise<PublicKey> {
  const results = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
    filters: [
      { dataSize: 165 },
      { memcmp: { offset: 0, bytes: position.getData().positionMint.toString() } },
    ],
  });

  const owners = results
    .map(res => ParsableTokenAccountInfo.parse(res.pubkey, res.account))
    .flatMap(ata => ata ? [ata] : [])
    .filter((ata) => ata.amount > BigInt(0))
    .map((ata) => ata.owner);

  invariant(owners.length === 1, "Expected exactly one owner for position")
  return owners[0];
}
