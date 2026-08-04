import { style } from "./style";

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Read a line from stdin (echoed). Returns null on EOF. */
export async function promptLine(label: string): Promise<string | null> {
  process.stdout.write(`${style.cyan(label)} `);
  const reader = process.stdin;
  reader.resume();
  reader.setEncoding("utf8");

  return await new Promise((resolve) => {
    const onData = (chunk: string | Buffer) => {
      cleanup();
      const text = String(chunk).replace(/\r?\n$/, "");
      resolve(text);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const cleanup = () => {
      reader.off("data", onData);
      reader.off("end", onEnd);
      reader.pause();
    };
    reader.on("data", onData);
    reader.on("end", onEnd);
  });
}

/**
 * Prompt for a secret with echo disabled when stdin is a TTY.
 * Falls back to a normal line read when raw mode is unavailable.
 */
export async function promptSecret(label: string): Promise<string | null> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return promptLine(label);
  }

  process.stdout.write(`${style.cyan(label)} `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  let value = "";
  return await new Promise((resolve) => {
    const onData = (chunk: string | Buffer) => {
      const text = String(chunk);
      for (const ch of text) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          resolve(null);
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
          }
          continue;
        }
        if (ch >= " ") {
          value += ch;
        }
      }
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // ignore
      }
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
  });
}
