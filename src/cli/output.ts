import { stringify as stringifyYaml } from "yaml";

import type { OutputFormat } from "./parse";

export function printOutput(format: OutputFormat, data: unknown): void {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (format === "yaml") {
    console.log(stringifyYaml(data));
    return;
  }

  if (data === null || data === undefined) {
    return;
  }

  if (typeof data === "string") {
    console.log(data);
    return;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      console.log(typeof item === "string" ? item : JSON.stringify(item));
    }
    return;
  }

  if (typeof data === "object") {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value === "object" && value !== null) {
        console.log(`${key}: ${JSON.stringify(value)}`);
      } else {
        console.log(`${key}: ${String(value)}`);
      }
    }
    return;
  }

  console.log(String(data));
}

export function printError(message: string, format: OutputFormat): void {
  if (format === "json") {
    console.error(JSON.stringify({ error: { message } }));
  } else {
    console.error(message);
  }
}

export function die(message: string, format: OutputFormat, code = 1): never {
  printError(message, format);
  process.exit(code);
}
