import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";
import type { WorkStatus, WorkStatusCompareWindow } from "@shared/work";

import type { WorkStore } from "../ports/work-store";

export type GetProjectWorkStatusInput = {
  projectId: string;
  compareWindow?: WorkStatusCompareWindow | null;
};

export type GetProjectWorkStatusDeps = { store: WorkStore };

export async function getProjectWorkStatusQuery(
  deps: GetProjectWorkStatusDeps,
  input: GetProjectWorkStatusInput,
): Promise<Result<WorkStatus, UseCaseFailure>> {
  if (!deps.store.projectExists(input.projectId)) {
    return useCaseFailure("not_found", "Project not found", 404);
  }
  const options = input.compareWindow ? { compareWindow: input.compareWindow } : {};
  return ok(deps.store.projectStatus(input.projectId, options));
}
