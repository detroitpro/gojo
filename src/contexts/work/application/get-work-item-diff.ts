import { ok, type Result } from "@/kernel";

import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { WorkStore } from "../ports/work-store";

export type GetWorkItemDiffInput = { id: string };
export type GetWorkItemDiffDeps = { store: WorkStore };

export async function getWorkItemDiffQuery(
  deps: GetWorkItemDiffDeps,
  input: GetWorkItemDiffInput,
): Promise<Result<{ workItemId: string; diff: string }, UseCaseFailure>> {
  try {
    return ok(await deps.store.getWorkItemDiff(input.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Work item not found")) {
      return useCaseFailure("not_found", message, 404);
    }
    return useCaseFailure("validation_error", message, 400);
  }
}
