import { ok, type Result } from "@/kernel";
import type { WorkItem } from "@shared/work";

import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { WorkStore } from "../ports/work-store";

export type ResolveWorkItemInput = {
  id: string;
  resolvedBy?: string | null;
  note?: string | null;
};

export type ResolveWorkItemDeps = { store: WorkStore };

export async function resolveWorkItemCommand(
  deps: ResolveWorkItemDeps,
  input: ResolveWorkItemInput,
): Promise<Result<{ work: WorkItem }, UseCaseFailure>> {
  const detail = deps.store.getWorkItemDetail(input.id);
  if (!detail) {
    return useCaseFailure("not_found", "Work item not found", 404);
  }
  try {
    const work = deps.store.resolveWorkItem(input.id, {
      resolvedBy: input.resolvedBy ?? null,
      note: input.note ?? null,
    });
    return ok({ work });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return useCaseFailure("validation_error", message, 400);
  }
}
