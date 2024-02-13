import type { PositionSummary } from "./analyze-position";
import { ansiLink, ansiRegex, green, info, linkAddress, red, resetColor } from "./logger";
import Decimal from "decimal.js";
import { capitalize } from "lodash";

function padEnd(value: string, maxLength: number) {
  const currentLength = value.replace(ansiRegex(), "").length;
  return value + " ".repeat(Math.max(0, maxLength - currentLength));
}

function rowId(summaries: PositionSummary[], groupBy?: "owner" | "whirlpool") {
  if (summaries.length === 0) {
    return "";
  }
  if (groupBy === "owner") {
    return linkAddress(summaries[0].owner.toBase58());
  }
  if (groupBy === "whirlpool") {
    const summary = summaries[0];
    const feeTier = (summary.feeTier / 10000).toFixed(2);
    const link = `https://orca.so/liquidity?address=${summary.whirlpool.toBase58()}`;
    return ansiLink(
      `${summary.tokenASymbol}/${summary.tokenBSymbol} ${feeTier}%`,
      link,
    )
  }
  return "";
}

function aggregateRow(
  summaries: PositionSummary[],
  columnWidth: number,
  groupBy?: "owner" | "whirlpool",
) {
  const firstPosition = summaries
    .reduce((acc, summary) => Math.min(acc, summary.openedAt), Number.MAX_SAFE_INTEGER);
  const averagePositionSize = summaries
    .reduce((acc, summary) => acc.plus(summary.positionSize), new Decimal(0))
    .div(summaries.length + Number.EPSILON);
  const averageProfitability = summaries
    .reduce((acc, summary) => acc.plus(summary.opportunityCost), new Decimal(0))
    .div(summaries.length + Number.EPSILON)
    .neg();
  const profitabilityColor = averageProfitability.gte(0) ? green : red;
  const row = [
    rowId(summaries, groupBy),
    summaries.length.toString(),
    new Date(firstPosition * 1000).toISOString().split("T")[0],
    `$${averagePositionSize.toFixed(2)}`,
    `${profitabilityColor}$${averageProfitability.toFixed(2)}${resetColor}`,
  ].map(value => padEnd(value, columnWidth))
    .join(" | ");
  return [`| ${row} |`, averageProfitability] as const;
}

export function logSummaryAggregates(
  summaries: PositionSummary[],
  groupBy: "owner" | "whirlpool",
) {
  const columns = [
    capitalize(groupBy),
    "No. Positions",
    "First position",
    "Av. Size",
    "Av. Profitability"
  ]

  const columnWidth = columns.reduce((acc, column) => Math.max(acc, column.length), 20);

  const header = columns
    .map(column => column.padEnd(columnWidth))
    .join(" | ");

  info("");
  info("|", header, "|");
  info("-".repeat(header.length + 4));

  const summariesMap = summaries.reduce((acc, summary) => {
    const key = summary[groupBy].toBase58();
    const current = acc.get(key) ?? [];
    acc.set(key, [...current, summary]);
    return acc;
  }, new Map<string, PositionSummary[]>());

  const rows = Array.from(summariesMap.values())
    .map((summaries) => aggregateRow(summaries, columnWidth, groupBy))
    .sort((a, b) => b[1].minus(a[1]).toNumber());

  rows.forEach((row) => info(row[0]));
  info("-".repeat(header.length + 4));

  const allSummaries = Array.from(summariesMap.values()).flat()
  info(aggregateRow(allSummaries, columnWidth)[0]);
  info("");
}

export function logLiquidityProviderAggregates(
  walletValues: ReadonlyMap<string, Decimal>,
) {
  const columns = [
    "Owner",
    "Max Value",
  ];
  const sortedWallets = Array.from(walletValues.entries()).sort((a, b) => b[1].minus(a[1]).toNumber());
  const columnWidth = columns.reduce((acc, column) => Math.max(acc, column.length), 15);

  const header = columns
  .map(column => column.padEnd(columnWidth))
    .join(" | ");

  info("");
  info("|", header, "|");
  info("-".repeat(header.length + 4));
  for (const [wallet, value] of sortedWallets) {
    const row =  [
      linkAddress(wallet),
      `$${value.toFixed(2)}`
    ].map(value => padEnd(value, columnWidth))
      .join(" | ");
    info(`| ${row} |`);
  }
  info("-".repeat(header.length + 4));
  info("");
}
