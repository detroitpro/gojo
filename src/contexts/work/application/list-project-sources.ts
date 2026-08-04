import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { ProjectSourceRow, WorkStore } from "../ports/work-store";

export type ListProjectSourcesInput = { projectId: string };
export type ListProjectSourcesDeps = { store: WorkStore };

export async function listProjectSourcesQuery(
  deps: ListProjectSourcesDeps,
  input: ListProjectSourcesInput,
): Promise<Result<{ sources: ProjectSourceRow[] }, UseCaseFailure>> {
  if (!deps.store.projectExists(input.projectId)) {
    return useCaseFailure("not_found", "Project not found", 404);
  }
  return ok({ sources: deps.store.listProjectSources(input.projectId) });
}
