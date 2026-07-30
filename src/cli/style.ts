/** ANSI styling for text-mode CLI. Disabled when not a TTY or NO_COLOR is set. */

const FORCE =
  process.env["FORCE_COLOR"] === "1" ||
  process.env["FORCE_COLOR"] === "true" ||
  process.env["FORCE_COLOR"] === "yes";

export function colorEnabled(stream: NodeJS.WriteStream = process.stdout): boolean {
  if (process.env["NO_COLOR"] != null && process.env["NO_COLOR"] !== "") {
    return false;
  }
  if (FORCE) {
    return true;
  }
  return Boolean(stream.isTTY);
}

function wrap(code: number, text: string, stream?: NodeJS.WriteStream): string {
  if (!colorEnabled(stream)) {
    return text;
  }
  return `\u001b[${code}m${text}\u001b[0m`;
}

export const style = {
  bold: (text: string) => wrap(1, text),
  dim: (text: string) => wrap(2, text),
  red: (text: string) => wrap(31, text),
  green: (text: string) => wrap(32, text),
  yellow: (text: string) => wrap(33, text),
  cyan: (text: string) => wrap(36, text),
  success: (text: string) => wrap(32, text),
  error: (text: string) => wrap(31, text),
  heading: (text: string) => wrap(36, wrap(1, text)),
};
