import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { CatalogStore } from "../ports/catalog-store";
import type { AgentDetailRow } from "../ports/catalog-store";

export type GetAgentInput = { id: string };

export async function getAgentQuery(
  store: CatalogStore,
  input: GetAgentInput,
): Promise<Result<{ agent: AgentDetailRow }, UseCaseFailure>> {
  const agent = store.getAgentDetail(input.id);
  if (!agent) {
    return useCaseFailure("not_found", "Agent not found", 404);
  }
  return ok({ agent });
}
