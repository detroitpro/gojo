import type { OutputFormat } from "./parse";
import { style } from "./style";

/** Documented CLI exit codes. */
export const ExitCode = {
  Ok: 0,
  Usage: 1,
  NotFound: 2,
  Conflict: 3,
  Auth: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export class CliError extends Error {
  readonly code: ExitCodeValue;
  readonly nextStep: string | undefined;

  constructor(message: string, options?: { code?: ExitCodeValue; nextStep?: string }) {
    super(message);
    this.name = "CliError";
    this.code = options?.code ?? ExitCode.Usage;
    this.nextStep = options?.nextStep;
  }
}

export function printError(message: string, format: OutputFormat, nextStep?: string): void {
  if (format === "json") {
    console.error(
      JSON.stringify({
        error: nextStep ? { message, nextStep } : { message },
      }),
    );
    return;
  }

  if (format === "yaml") {
    console.error(`error: ${message}`);
    if (nextStep) {
      console.error(`nextStep: ${nextStep}`);
    }
    return;
  }

  console.error(style.error(`Error: ${message}`));
  if (nextStep) {
    console.error(style.dim(`Next: ${nextStep}`));
  }
}

export function die(
  message: string,
  format: OutputFormat,
  code: ExitCodeValue = ExitCode.Usage,
  nextStep?: string,
): never {
  printError(message, format, nextStep);
  process.exit(code);
}

export function dieCli(error: CliError, format: OutputFormat): never {
  die(error.message, format, error.code, error.nextStep);
}
