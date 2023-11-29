import type { Address } from "@orca-so/common-sdk";
import { args } from "./arguments";

let loadingText = "";
const sequence = ["⠷", "⠯", "⠟", "⠻", "⠽", "⠾"];
let intervalId: NodeJS.Timeout | null = null;

// ANSI escape codes
export const clearLine = "\x1b[K";
export const cursorStart = "\r";
export const cursorDown = "\n";
export const red = "\x1B[31m";
export const green = "\x1B[32m";
export const yellow = "\x1B[33m";
export const blue = "\x1B[34m";
export const resetColor = "\x1B[0m";

function ansiLink(str: string, url: string) {
  return `\u{1b}]8;;${url}\u{7}${str}\u{1b}]8;;\u{7}`;
}

export function ansiRegex({onlyFirst = false} = {}) {
	const pattern = [
		'[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
		'(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))'
	].join('|');
	return new RegExp(pattern, onlyFirst ? undefined : 'g');
}

export function linkAddress(...addresses: Address[]) {
  if (addresses.length === 0) {
    return "";
  }
  if (addresses.length > 3) {
    return `${addresses.length} addresses`;
  }
  const parts: string[] = [];
  for (const address of addresses) {
    const addressStr = address.toString();
    const abbreviatedAddress = args.fullAddress ? addressStr : `${addressStr.slice(0, 4)}...${addressStr.slice(-4)}`;
    const link = `https://solscan.io/account/${addressStr}`;
    parts.push(ansiLink(abbreviatedAddress, link));
  }
  const suffix = parts.length > 1 ? ` and ${parts.pop()}` : "";
  return parts.join(", ") + suffix;
}

function log(message?: string, opts?: { file?: NodeJS.WriteStream; ephemeral?: boolean }) {
  if (args.quiet) {
    return;
  }
  const { file = process.stdout, ephemeral = false } = opts ?? {};
  const terminator = ephemeral ? cursorStart : cursorDown;
  file.write(`${clearLine}${cursorStart}${message ?? ""}${terminator}`);
}

function formattedTime() {
  const time = new Date().toISOString().slice(11, -1);
  return `${blue}[${time}]${resetColor}`;
}

export function debug(...message: Array<unknown>) {
  if (args.debug) {
    const content = message.map((m) => `${m}`).join(" ");
    log(`${formattedTime()} ${content}`);
  }
}

export function info(...message: Array<unknown>) {
  log(message.map((m) => `${m}`).join(" "));
}

export function warn(...message: Array<unknown>) {
  if (args.debug) {
    const warningMessage = message.map((m) => `${m}`).join(" ");
    log(`${formattedTime()} ${yellow}${warningMessage}${resetColor}`, { file: process.stderr });
  }
}

export function err(...message: Array<unknown>) {
  const errorMessage = message.map((m) => `${m}`).join(" ");
  log(`${formattedTime()} ${red}${errorMessage}${resetColor}`, { file: process.stderr });
}

export function setLoadingText(text = "") {
  loadingText = text;
}

export function stopLoading() {
  if (intervalId == null) {
    return;
  }
  clearInterval(intervalId);
  log(clearLine, { ephemeral: true });
  intervalId = null;
}

export function startLoading(text = "") {
  loadingText = text;
  let index = 0;

  intervalId = setInterval(() => {
    log(`${sequence[index % sequence.length]} ${loadingText}`, { ephemeral: true });
    index++;
  }, 100);
}
