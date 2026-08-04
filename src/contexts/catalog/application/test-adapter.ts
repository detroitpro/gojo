import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { AdapterRegistryPort } from "../ports/adapter-registry";

export type TestAdapterInput = {
  name: string;
  workspacePath?: string;
  prompt?: string;
  timeoutMs?: number;
};

export async function testAdapterCommand(
  registry: AdapterRegistryPort,
  input: TestAdapterInput,
): Promise<Result<{ result: unknown }, UseCaseFailure>> {
  const adapter = registry.find(input.name);
  if (!adapter) {
    return useCaseFailure("not_found", "Adapter not found", 404);
  }
  const timeoutMs = input.timeoutMs ?? 10_000;
  const result = await adapter.execute({
    workspacePath: input.workspacePath ?? process.cwd(),
    prompt: input.prompt ?? "#!/bin/sh\necho gojo-agent-test",
    env: {},
    timeoutMs,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return ok({ result });
}
