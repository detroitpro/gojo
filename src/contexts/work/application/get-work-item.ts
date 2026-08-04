import { ok, type Result } from "@/kernel";

import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { WorkItemDetail, WorkStore } from "../ports/work-store";

export type GetWorkItemInput = { id: string };
export type GetWorkItemDeps = { store: WorkStore };

export async function getWorkItemQuery(
  deps: GetWorkItemDeps,
  input: GetWorkItemInput,
): Promise<Result<WorkItemDetail, UseCaseFailure>> {
  const detail = deps.store.getWorkItemDetail(input.id);
  if (!detail) return useCaseFailure("not_found", "Work item not found", 404);
  return ok(detail);
}
