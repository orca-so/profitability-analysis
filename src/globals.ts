import { AnchorProvider, BN, BorshCoder } from "@coral-xyz/anchor";
import {
  buildDefaultAccountFetcher,
  WhirlpoolContext,
  buildWhirlpoolClient,
  WHIRLPOOL_IDL,
} from "@orca-so/whirlpools-sdk";
import type { Transaction, VersionedTransaction } from "@solana/web3.js";
import { Connection, PublicKey } from "@solana/web3.js";

export const ORCA_WHIRLPOOLS_CONFIG = new PublicKey("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ");
export const WHIRLPOOL_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

export const rpcUrl = process.env.RPC_URL || "";
export const coingeckoKey = process.env.COINGECKO_PRO_API_KEY || "";

const fauxWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction | VersionedTransaction>(): Promise<T> =>
    Promise.reject(new Error("Not implemented")),
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(): Promise<Array<T>> =>
    Promise.reject(new Error("Not implemented")),
};

export const web3Connection = new Connection(rpcUrl);
export const anchorProvider = new AnchorProvider(web3Connection, fauxWallet, {
  commitment: "confirmed",
});

export const accountFetcher = buildDefaultAccountFetcher(anchorProvider.connection);
export const anchorContext = WhirlpoolContext.withProvider(
  anchorProvider,
  WHIRLPOOL_PROGRAM_ID,
  accountFetcher,
);
export const borshCoder = new BorshCoder(WHIRLPOOL_IDL);
export const whirlpoolClient = buildWhirlpoolClient(anchorContext);
export const connection = anchorContext.connection;


// Estimate of opening closing the nft token account and the position account
export const PAYABLE_RENT_LAMPORTS = new BN(2394240 + 1461600 + 2039280 + 15616720);
export const PAYABLE_RENT_LAMPORTS_WITHOUT_METADATA = new BN(2394240 + 1461600 + 2039280);
export const RECLAIMABLE_RENT_LAMPORTS = new BN(2394240 + 2039280);
export const CLOSE_TRANSACTION_LAMPORTS = new BN(10000);
