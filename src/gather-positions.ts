import type { Address} from "@orca-so/common-sdk";
import { AddressUtil } from "@orca-so/common-sdk";
import type { Position } from "@orca-so/whirlpools-sdk";
import { AccountName, PREFER_CACHE, WHIRLPOOL_CODER, getAccountSize } from "@orca-so/whirlpools-sdk";
import { WHIRLPOOL_PROGRAM_ID, connection, whirlpoolClient } from "./globals";
import { debug } from "./logger";

// There are couple of limitations to to this function:
// * Will only fetch open positions (because closed position accounts are closed)
// * Truncated at 10MB worth of account data. This is a limitation of the RPC.
export async function gatherPositions(
  pool?: Address,
  includeOutOfRange = false,
): Promise<Position[]> {

  const filters = [
    { dataSize: getAccountSize(AccountName.Position) },
    {
      memcmp: WHIRLPOOL_CODER.memcmp(
        AccountName.Position,
        pool ? AddressUtil.toPubKey(pool).toBuffer() : undefined
      ),
    },
  ];

  const accounts = await connection.getProgramAccounts(WHIRLPOOL_PROGRAM_ID, {
    filters,
  });

  const addresses = accounts.map((account) => account.pubkey);
  const positions = await whirlpoolClient.getPositions(addresses, PREFER_CACHE);
  const filteredPositions = Object.values(positions).flatMap((value) =>
    value && isInRange(value, includeOutOfRange) ? [value] : []
  );

  debug("Fetched account data for", filteredPositions.length, filteredPositions.length === 1 ? "position" : "positions");

  return filteredPositions;
}

function isInRange(position: Position, includeOutOfRange: boolean) {
  if (includeOutOfRange) {
    return true;
  }
  const positionData = position.getData();
  const whirlpoolData = position.getWhirlpoolData();
  const currentTickIndex = whirlpoolData.tickCurrentIndex;
  const tickLowerIndex = positionData.tickLowerIndex;
  const tickUpperIndex = positionData.tickUpperIndex;
  return tickLowerIndex <= currentTickIndex && currentTickIndex <= tickUpperIndex;
}
