import { ok, type Result } from "@/kernel";

import type { AdapterRegistryPort } from "../ports/adapter-registry";

export type ListAdaptersOutput = {
  adapters: Array<{ name: string } & Record<string, unknown>>;
};

export async function listAdaptersQuery(
  registry: AdapterRegistryPort,
): Promise<Result<ListAdaptersOutput>> {
  const detected = await Promise.all(
    registry.list().map(async (adapter) => ({
      name: adapter.name,
      ...(await adapter.detect()),
    })),
  );
  return ok({ adapters: detected });
}
