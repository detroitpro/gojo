import { ok, type Result } from "@/kernel";

import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { WorkStore } from "../ports/work-store";

export type RefreshProjectSourceInput = {
  projectId: string;
  sourceId: string;
};

export type RefreshProjectSourceDeps = { store: WorkStore };

export async function refreshProjectSourceCommand(
  deps: RefreshProjectSourceDeps,
  input: RefreshProjectSourceInput,
): Promise<Result<{ sync: unknown }, UseCaseFailure>> {
  if (!deps.store.projectExists(input.projectId)) {
    return useCaseFailure("not_found", "Project not found", 404);
  }
  try {
    const sync = await deps.store.refreshSource(input.sourceId, input.projectId);
    return ok({ sync });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Project source not found")) {
      return useCaseFailure("not_found", "Project source not found", 404);
    }
    return useCaseFailure("validation_error", message, 400);
  }
}
