import yargs from "yargs";
import { hideBin } from "yargs/helpers";

type BaseArgs = {
  quiet: boolean;
  debug: boolean;
  fullAddress: boolean;
}

type AnalyzeArgs = BaseArgs & {
  command: "analyze";
  address: string[];
  cycles: number;
  includeOpen: boolean;
  csv: string;
  summary: "owner" | "whirlpool";
}

type FindArgs = BaseArgs & {
  command: "find";
  includeOutOfRange: boolean;
  count: number;
  min: number;
  max: number;
  pool?: string;
  asParams: boolean;
}

type Args = AnalyzeArgs | FindArgs;

const internalArgs = yargs(hideBin(process.argv))
  .scriptName("pnl")
  .command("*", "Analyze transactions for a given address", (yargs) => {
    yargs.option("address", {
      alias: "a",
      type: "array",
      demandOption: true,
      desc: "Address(es) of account to analyze",
    })
    .option("cycles", {
      alias: "n",
      type: "number",
      default: 1,
      desc: "Number of 1000 sig cycles to analyze",
    })
    .option("include-open", {
      type: "boolean",
      default: false,
      desc: "Include still open positions",
    })
    .option("summary",{
      alias: "s",
      choices: ["owner", "whirlpool"],
      default: "owner",
      desc: "Summarize by this type",
    })
    .option("csv", { type: "string", desc: "Output to csv file" })
  })
  .command("find", "Find currently active LPs", (yargs) => {
    yargs.option("pool", {
      alias: "p",
      type: "string",
      desc: "Only include LPs active in a specific pool",
    })
    .option("include-out-of-range", {
      type: "boolean",
      default: false,
      desc: "Include LPs that are out of range",
    })
    .option("count", {
      alias: "n",
      type: "number",
      default: 100,
      desc: "Maximum number of LPs to find",
    })
    .option("min", {
      type: "number",
      desc: "Minimum deposit amount in usd",
    })
    .option("max", {
      type: "number",
      desc: "Maximum deposit amount in usd",
    })
    .option("as-params", {
      type: "boolean",
      default: false,
      desc: "Output as params for the analyze command",
    })
  })
  .option("quiet", { alias: "q", type: "boolean", default: false, desc: "Mute logging" })
  .option("debug", { alias: "d", type: "boolean", default: false, desc: "Enable debug logging" })
  .option("full-address", { type: "boolean", default: false, desc: "Show full address" })
  .alias("h", "help")
  .version(false)
  .recommendCommands()
  .strict()
  .parseSync();

export const args = {
  ...<object>internalArgs,
  command: internalArgs._[0] ?? "analyze",
} as Args;
