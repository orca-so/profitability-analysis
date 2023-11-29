import invariant from "tiny-invariant";
import type { GatheredInstruction } from "./gather-instructions";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  PAYABLE_RENT_LAMPORTS,
  PAYABLE_RENT_LAMPORTS_WITHOUT_METADATA,
  RECLAIMABLE_RENT_LAMPORTS,
  WHIRLPOOL_PROGRAM_ID,
  borshCoder,
} from "./globals";
import type { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { debug } from "./logger";

export type OpenPositionInstruction = {
  type: "openPosition";
  whirlpool: PublicKey;
  position: PublicKey;
  positionMint: PublicKey;
  owner: PublicKey;
  tickUpperIndex: number;
  tickLowerIndex: number;
  rentFee: BN;
};

export type IncreaseLiquidityInstruction = {
  type: "increaseLiquidity";
  whirlpool: PublicKey;
  position: PublicKey;
  liquidityIn: BN;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAIn: BN;
  tokenBIn: BN;
};

export type DecreaseLiquidityInstruction = {
  type: "decreaseLiquidity";
  whirlpool: PublicKey;
  position: PublicKey;
  liquidityOut: BN;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAOut: BN;
  tokenBOut: BN;
};

export type CollectFeesInstruction = {
  type: "collectFees";
  whirlpool: PublicKey;
  position: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAFee: BN;
  tokenBFee: BN;
};

export type CollectRewardInstruction = {
  type: "collectReward";
  whirlpool: PublicKey;
  position: PublicKey;
  rewardIndex: number;
  rewardMint: PublicKey;
  rewardAmount: BN;
};

export type ClosePositionInstruction = {
  type: "closePosition";
  position: PublicKey;
  reclaimedRent: BN;
};

type InstructionUnion =
  | OpenPositionInstruction
  | IncreaseLiquidityInstruction
  | DecreaseLiquidityInstruction
  | CollectFeesInstruction
  | CollectRewardInstruction
  | ClosePositionInstruction;

export type DecodedInstruction = InstructionUnion & GatheredInstruction;

export function decodeTransactions(transactions: GatheredInstruction[][]): Map<string, DecodedInstruction[]> {
  const instructions: DecodedInstruction[] = [];
  for (let i = 0; i < transactions.length; i++) {
    for (let j = 0; j < transactions[i].length; j++) {
      try {
        instructions.push(decodeTransaction(j, transactions[i]));
      } catch {
        continue;
      }
    }
  }
  const positionInstructions = instructions.reduce((acc, instruction) => {
    const current = acc.get(instruction.position.toString()) ?? [];
    acc.set(instruction.position.toString(), [...current, instruction]);
    return acc;
  }, new Map<string, DecodedInstruction[]>());
  debug("Decoded", instructions.length, "instructions as whirlpool instructions");
  return positionInstructions;
}

export function decodeTransaction(
  index: number,
  instructions: GatheredInstruction[],
): DecodedInstruction {
  const instruction = instructions[index];
  invariant(
    instruction.programId.equals(WHIRLPOOL_PROGRAM_ID),
    "Instruction is not a whirlpool instruction",
  );
  invariant("accounts" in instruction, "Instruction is not a parsed instruction");
  invariant("data" in instruction, "Instruction is not a parsed instruction");
  const decodedData = borshCoder.instruction.decode(instruction.data, "base58");
  invariant(decodedData?.name, "Instruction data does not contain name");
  const handler = decodeInstructionMap[decodedData.name];
  invariant(handler, `Instruction data name ${decodedData.name} is not supported`);
  const a = {
    ...handler(instruction.accounts, decodedData.data, decodedData.name, index, instructions),
    ...instruction,
  };

  return a;
}

type InstructionDecoder = (
  accounts: PublicKey[],
  data: object,
  name: string,
  index: number,
  instructions: GatheredInstruction[],
) => InstructionUnion;

const decodeInstructionMap: Record<string, InstructionDecoder> = {
  openPosition: decodeOpenPosition,
  openPositionWithMetadata: decodeOpenPosition,
  increaseLiquidity: decodeIncreaseLiquidity,
  decreaseLiquidity: decodeDecreaseLiquidity,
  collectFees: decodeCollectFee,
  collectReward: decodeCollectReward,
  closePosition: decodeClosePosition,
};

function decodeOpenPosition(accounts: PublicKey[], data: object, name: string): OpenPositionInstruction {
  const whirlpoolAccountIndex =
    accounts.findIndex((account) => account.equals(TOKEN_PROGRAM_ID)) - 1;
  const whirlpoolAccount = accounts[whirlpoolAccountIndex];
  invariant(whirlpoolAccount, "Could not find whirlpool account for openPosition ix");
  const ownerAccount = accounts[1];
  invariant(ownerAccount, "Could not find owner account for openPosition ix");
  const positionAccount = accounts[2];
  invariant(positionAccount, "Could not find position account for openPosition ix");

  const positionMintAccount = accounts[3];
  invariant(positionMintAccount, "Could not find position mint account for openPosition ix");

  invariant("tickLowerIndex" in data, "Instruction data does not contain tickLowerIndex");
  invariant(typeof data.tickLowerIndex === "number", "tickLowerIndex is not a number");
  invariant("tickUpperIndex" in data, "Instruction data does not contain tickUpperIndex");
  invariant(typeof data.tickUpperIndex === "number", "tickUpperIndex is not a number");

  const rentFee = name === "openPositionWithMetadata" ? PAYABLE_RENT_LAMPORTS : PAYABLE_RENT_LAMPORTS_WITHOUT_METADATA;

  return {
    type: "openPosition",
    whirlpool: whirlpoolAccount,
    position: positionAccount,
    owner: ownerAccount,
    positionMint: positionMintAccount,
    tickUpperIndex: data.tickLowerIndex,
    tickLowerIndex: data.tickUpperIndex,
    rentFee,
  };
}

function decodeIncreaseLiquidity(
  accounts: PublicKey[],
  data: object,
  _name: string,
  index: number,
  instructions: GatheredInstruction[],
): IncreaseLiquidityInstruction {
  const whirlpoolAccount = accounts[0];
  invariant(whirlpoolAccount, "Could not find whirlpool account for openPosition ix");
  const positionAccount = accounts[3];
  invariant(positionAccount, "Could not find position account for openPosition ix");

  invariant("liquidityAmount" in data, "Instruction data does not contain liquidityAmount");
  invariant(data.liquidityAmount instanceof BN, "liquidityAmount is not a number");

  const tokenAMint = reduceTokenMintFromAccount(instructions[index], accounts[7]);
  const tokenBMint = reduceTokenMintFromAccount(instructions[index], accounts[8]);

  const [tokenAIn, nextTokenTransferIndex] = nextTokenTransferAmount(index, instructions);
  invariant(tokenAIn, "Could not find reward amount for increaseLiquidity ix");
  const [tokenBIn] = nextTokenTransferAmount(nextTokenTransferIndex, instructions);
  invariant(tokenBIn, "Could not find reward amount for increaseLiquidity ix");

  return {
    type: "increaseLiquidity",
    whirlpool: whirlpoolAccount,
    position: positionAccount,
    liquidityIn: data.liquidityAmount,
    tokenAMint,
    tokenBMint,
    tokenAIn,
    tokenBIn,
  };
}

function decodeDecreaseLiquidity(
  accounts: PublicKey[],
  data: object,
  _name: string,
  index: number,
  instructions: GatheredInstruction[],
): DecreaseLiquidityInstruction {
  const whirlpoolAccount = accounts[0];
  invariant(whirlpoolAccount, "Could not find whirlpool account for decreaseLiquidity ix");
  const positionAccount = accounts[3];
  invariant(positionAccount, "Could not find position account for decreaseLiquidity ix");

  invariant("liquidityAmount" in data, "Instruction data does not contain liquidityAmount");
  invariant(data.liquidityAmount instanceof BN, "liquidityAmount is not a number");

  const tokenAMint = reduceTokenMintFromAccount(instructions[index], accounts[7]);
  const tokenBMint = reduceTokenMintFromAccount(instructions[index], accounts[8]);

  const [tokenAOut, nextTokenTransferIndex] = nextTokenTransferAmount(index, instructions);
  invariant(tokenAOut, "Could not find reward amount for decreaseLiquidity ix");
  const [tokenBOut] = nextTokenTransferAmount(nextTokenTransferIndex, instructions);
  invariant(tokenBOut, "Could not find reward amount for decreaseLiquidity ix");

  return {
    type: "decreaseLiquidity" as const,
    whirlpool: whirlpoolAccount,
    position: positionAccount,
    liquidityOut: data.liquidityAmount,
    tokenAMint,
    tokenBMint,
    tokenAOut,
    tokenBOut,
  };
}

function decodeCollectFee(
  accounts: PublicKey[],
  _data: object,
  _name: string,
  index: number,
  instructions: GatheredInstruction[],
): CollectFeesInstruction {
  const whirlpoolAccount = accounts[0];
  invariant(whirlpoolAccount, "Could not find whirlpool account for collectFees ix");
  const positionAccount = accounts[2];
  invariant(positionAccount, "Could not find position account for collectFees ix");

  const tokenAMint = reduceTokenMintFromAccount(instructions[index], accounts[5]);
  const tokenBMint = reduceTokenMintFromAccount(instructions[index], accounts[7]);

  const [tokenAFee, nextTokenTransferIndex] = nextTokenTransferAmount(index, instructions);
  invariant(tokenAFee, "Could not find reward amount for collectFee ix");
  const [tokenBFee] = nextTokenTransferAmount(nextTokenTransferIndex, instructions);
  invariant(tokenBFee, "Could not find reward amount for collectFee ix");

  return {
    type: "collectFees" as const,
    whirlpool: whirlpoolAccount,
    position: positionAccount,
    tokenAMint,
    tokenBMint,
    tokenAFee,
    tokenBFee,
  };
}

function decodeCollectReward(
  accounts: PublicKey[],
  data: object,
  _name: string,
  index: number,
  instructions: GatheredInstruction[],
): CollectRewardInstruction {
  const whirlpoolAccount = accounts[0];
  invariant(whirlpoolAccount, "Could not find whirlpool account for collectFees ix");
  const positionAccount = accounts[2];
  invariant(positionAccount, "Could not find position account for collectFees ix");

  invariant("rewardIndex" in data, "Instruction data does not contain liquidityAmount");
  invariant(typeof data.rewardIndex === "number", "liquidityAmount is not a number");

  const rewardMint = reduceTokenMintFromAccount(instructions[index], accounts[5]);
  const [rewardAmount] = nextTokenTransferAmount(index, instructions);
  invariant(rewardAmount, "Could not find reward amount for collectReward ix");

  return {
    type: "collectReward" as const,
    whirlpool: whirlpoolAccount,
    position: positionAccount,
    rewardIndex: data.rewardIndex,
    rewardMint,
    rewardAmount,
  };
}

function decodeClosePosition(accounts: PublicKey[], _data: object): ClosePositionInstruction {
  const positionAccount = accounts[2];
  invariant(positionAccount, "Could not find position account for collectFees ix");

  return {
    type: "closePosition" as const,
    position: positionAccount,
    reclaimedRent: RECLAIMABLE_RENT_LAMPORTS,
  };
}

function reduceTokenMintFromAccount(instruction: GatheredInstruction, tokenAccount: PublicKey): PublicKey {
  const mint = instruction.tokenMints.get(tokenAccount.toString());
  invariant(mint, "Could reduce mint from token account");
  return mint;
}

function nextTokenTransferAmount(
  index: number,
  instructions: GatheredInstruction[],
): [BN, number] | [undefined, undefined] {
  for (let i = index + 1; i < instructions.length; i++) {
    const instruction = instructions[i];
    if (
      "parsed" in instruction &&
      instruction.program === "spl-token" &&
      instruction.parsed?.type === "transfer"
    ) {
      invariant("info" in instruction.parsed, "Transfer instruction does not contain info");
      invariant(typeof instruction.parsed.info === "object", "Transfer info is not an object");
      invariant("amount" in instruction.parsed.info, "Transfer info does not contain amount");
      invariant(
        typeof instruction.parsed.info.amount === "string",
        "Reward amount is not a string",
      );
      const amount = new BN(instruction.parsed.info.amount);
      return [amount, i];
    }
  }
  return [undefined, undefined];
}
