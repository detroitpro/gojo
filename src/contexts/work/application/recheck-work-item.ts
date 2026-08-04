import { ok, type Result } from "@/kernel";
import type { WorkRecheckResult } from "@shared/work";

import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { WorkStore } from "../ports/work-store";

export type RecheckWorkItemInput = { id: string };
export type RecheckWorkItemDeps = { store: WorkStore };

export async function recheckWorkItemCommand(
  deps: RecheckWorkItemDeps,
  input: RecheckWorkItemInput,
): Promise<Result<{ result: WorkRecheckResult }, UseCaseFailure>> {
  const detail = deps.store.getWorkItemDetail(input.id);
  if (!detail) {
    return useCaseFailure("not_found", "Work item not found", 404);
  }
  try {
    const result = await deps.store.recheckWorkItem(input.id);
    return ok({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return useCaseFailure("validation_error", message, 400);
  }
}
