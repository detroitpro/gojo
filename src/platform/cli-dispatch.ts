import type { AppContext } from "@/platform/app-context";
import type { OutputFormat } from "@/transports/cli/parse";
import { die, printOutput } from "@/transports/cli/output";
import { ExitCode } from "@/transports/cli/errors";

import { failureMessage } from "./errors";
import type { UseCaseRegistry } from "./registry";
import { createAppRuntime } from "./runtime";

/**
 * Try to run a CLI group/command via the use-case registry.
 * Returns true when handled; false when the caller should use a legacy handler.
 */
export async function tryDispatchCliUseCase(
  registry: UseCaseRegistry,
  ctx: AppContext,
  group: string,
  command: string,
  rawInput: unknown,
  format: OutputFormat,
): Promise<boolean> {
  const useCase = registry.findCli(group, command);
  if (!useCase) {
    return false;
  }

  const runtime = createAppRuntime(ctx);
  const result = await registry.execute(useCase.name, rawInput, runtime);
  if (!result.ok) {
    die(
      failureMessage(result.error),
      format,
      useCase.kind === "query" ? ExitCode.Usage : ExitCode.Usage,
    );
  }
  printOutput(format, result.value);
  return true;
}
