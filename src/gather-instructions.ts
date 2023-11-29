import type {
  ConfirmedSignatureInfo,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  TransactionSignature,
} from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { connection } from "./globals";
import { debug, linkAddress } from "./logger";
import { chunk } from "lodash";
import type { Address } from "@orca-so/common-sdk";
import PQueue from "p-queue";

export type GatheredTransaction = ParsedTransactionWithMeta & ConfirmedSignatureInfo;

export type GatheredInstruction = (ParsedInstruction | PartiallyDecodedInstruction) & {
  signature: TransactionSignature;
  blockTime: number;
  transactionFee: number;
  tokenMints: Map<string, PublicKey>;
};

export async function gatherInstructions(
  addresses: Address[],
  cycles: number,
): Promise<Map<string, GatheredInstruction[]>> {
  const transactions = await gatherTransactions(addresses, cycles);
  const instructions = transactions.flatMap(extractInstructions);
  const transactionInstructions = instructions.reduce((acc, instruction) => {
    const current = acc.get(instruction.signature) ?? [];
    acc.set(instruction.signature, [...current, instruction]);
    return acc;
  }, new Map<string, GatheredInstruction[]>());
  debug("Found", instructions.length, "unique instructions for", linkAddress(...addresses));
  return transactionInstructions;
}

function extractInstructions(transaction: GatheredTransaction): GatheredInstruction[] {
  if (transaction.err || transaction.meta?.err) {
    return [];
  }

  const instructions = transaction.transaction.message.instructions;
  const innerInstructions = transaction.meta?.innerInstructions ?? [];
  const orderedInstructions: Array<ParsedInstruction | PartiallyDecodedInstruction> = [];

  for (let i = 0; i < instructions.length; i++) {
    orderedInstructions.push(instructions[i]);
    const innerInstruction = innerInstructions.find((inner) => inner.index === i);
    if (innerInstruction) {
      orderedInstructions.push(...innerInstruction.instructions);
    }
  }

  const tokenMints = new Map<string, PublicKey>();
  for (const balance of transaction.meta?.postTokenBalances ?? []) {
    const tokenAccount = transaction.transaction.message.accountKeys[balance.accountIndex];
    tokenMints.set(tokenAccount.pubkey.toString(), new PublicKey(balance.mint));
  }

  return orderedInstructions.map((instruction) => ({
    signature: transaction.signature,
    blockTime: transaction.blockTime ?? 0,
    transactionFee: transaction.meta?.fee ?? 0,
    tokenMints,
    ...instruction,
  }));
}

const TRANSACTIONS_LIMIT = 1000;

async function getSignaturesForAddress(
  address: Address,
  cycles: number,
) {
  const signatures: Array<ConfirmedSignatureInfo> = [];
  for (let i = 0; i < cycles; i++) {
    const before = signatures.length > 0 ? signatures[signatures.length - 1].signature : undefined;
    const sigInfos = await connection.getSignaturesForAddress(new PublicKey(address), { before });
    signatures.push(...sigInfos);
    if (sigInfos.length < TRANSACTIONS_LIMIT) {
      return signatures;
    }
  }
  return signatures;
}

async function getTransactionsForSignatures(
  signatures: ConfirmedSignatureInfo[]
) {
  const sigs = signatures.map(sig => sig.signature);
  const transactions = await connection.getParsedTransactions(sigs,
  {
  commitment: "confirmed",
  maxSupportedTransactionVersion: 0,
  }
);
  return transactions;
}

async function gatherTransactions(
  addresses: Address[],
  cycles: number,
): Promise<GatheredTransaction[]> {
  const queue = new PQueue({ concurrency: 10, interval: 200 });
  const uniqueSignatures = await queue.addAll(
    addresses.map(address => async () => {
      return await getSignaturesForAddress(address, cycles);
    })
  ).then(x => x.flat())
  .then(x => new Set(x));

  debug("Found", uniqueSignatures.size, "unique", uniqueSignatures.size === 1 ? "signature" : "signatures", "for", linkAddress(...addresses));

  const signatures = Array.from(uniqueSignatures);
  const transactions = await queue.addAll(
    chunk(signatures, TRANSACTIONS_LIMIT).map(sig => () => getTransactionsForSignatures(sig)),
  ).then(x => x.flat());

  const transactionsAndInfos: GatheredTransaction[] = [];
  for (let i = 0; i < signatures.length; i++) {
    const signature = signatures[i];
    const transaction = transactions[i];
    if (transaction) {
      transactionsAndInfos.push({ ...transaction, ...signature });
    }
  }

  debug("Found", transactionsAndInfos.length, transactionsAndInfos.length === 1 ? "transaction" : "transactions", "for", linkAddress(...addresses));
  return transactionsAndInfos;
}
