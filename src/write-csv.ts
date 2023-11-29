import type { Stringifier } from "csv-stringify";
import { stringify } from "csv-stringify";
import fs from "fs";
import { dirname } from "path";
import type { PositionSummary } from "./analyze-position";
import { debug, green, linkAddress, red, resetColor } from "./logger";
import Decimal from "decimal.js";

export type CSVRow = {
  [K in keyof PositionSummary]: string;
};

function logSummary(summary: PositionSummary) {
  const profit = [
    summary.profit.gte(0) ? green : red,
    `$${summary.profit.abs().toFixed(2)}`,
    resetColor,
  ].join("");

  const opportunityCost = [
    summary.opportunityCost.lte(0) ? green : red,
    `$${summary.opportunityCost.abs().toFixed(2)}`,
    resetColor,
  ].join("");

  debug(
    linkAddress(summary.position.toBase58()),
    summary.closedAt ? "had" : "has",
    "a raw",
    summary.profit.gte(0) ? "profit" : "loss",
    "of",
    profit,
    `(${summary.profitRatio.mul(100).toFixed(0)}%)`,
    "which is",
    opportunityCost,
    `(${summary.opportunityCostRatio.mul(100).toFixed(0)}%)`,
    summary.opportunityCost.lte(0) ? "better" : "worse",
    "than not opening the position",
  );
}

export function logPositionSummaries(summaries: PositionSummary[]) {
  summaries.forEach(logSummary);
}

export async function writePositionSummaries(
  summaries: PositionSummary[],
  file: string,
) {
  if (fs.existsSync(file)) {
    debug(file, "already exists, deleting it");
    fs.rmSync(file, { recursive: true, force: true });
  }

  if (!fs.existsSync(dirname(file))) {
    debug("Creating folder", dirname(file));
    fs.mkdirSync(dirname(file));
  }

  const summaryWriteStream = fs.createWriteStream(file, {
    autoClose: true,
  });
  const stringifier = stringify({ header: true });
  stringifier.pipe(summaryWriteStream);

  await Promise.all(summaries.map((summary) => writePositionSummary(summary, stringifier)));
}

function writePositionSummary(
  summary: PositionSummary,
  summaryStringifier: Stringifier,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const row = Object.entries(summary).reduce((acc, entry) => {
      const [key, value] = entry;
      if (Decimal.isDecimal(value)) {
        return { ...acc, [key]: value.toFixed(2) };
      }
      return { ...acc, [key]: value.toString() };
    }, {} as Partial<CSVRow>);

    summaryStringifier.write(row, undefined, (e) => {
      if (e) {
        reject(`${e?.name} - ${e?.message}`);
      } else {
        resolve();
      }
    });
  });
}
