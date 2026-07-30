import { stringify as stringifyYaml } from "yaml";

import { die as dieWithCode, printError as printErrorStyled, type ExitCodeValue } from "./errors";
import type { OutputFormat } from "./parse";
import { style } from "./style";
import { formatKeyValue } from "./table";

export { ExitCode, CliError, dieCli } from "./errors";
export type { ExitCodeValue } from "./errors";

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
    const entries = Object.entries(data as Record<string, unknown>).map(([key, value]) => {
      if (typeof value === "object" && value !== null) {
        return [key, JSON.stringify(value)] as [string, string];
      }
      return [key, value == null ? null : String(value)] as [string, string | null];
    });
    console.log(formatKeyValue(entries));
    return;
  }

  console.log(String(data));
}

export function printSuccess(message: string, format: OutputFormat): void {
  if (format === "json" || format === "yaml") {
    return;
  }
  console.log(style.success(`✓ ${message}`));
}

export function printSection(title: string, format: OutputFormat): void {
  if (format !== "text") {
    return;
  }
  console.log(style.heading(title));
}

export function printError(message: string, format: OutputFormat, nextStep?: string): void {
  printErrorStyled(message, format, nextStep);
}

export function die(
  message: string,
  format: OutputFormat,
  code: ExitCodeValue = 1,
  nextStep?: string,
): never {
  return dieWithCode(message, format, code, nextStep);
}
