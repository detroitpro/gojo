import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { CatalogStore } from "../ports/catalog-store";
import type { ProjectDetailRow } from "../ports/catalog-store";

export type GetProjectInput = { id: string };

export async function getProjectQuery(
  store: CatalogStore,
  input: GetProjectInput,
): Promise<Result<{ project: ProjectDetailRow }, UseCaseFailure>> {
  const project = store.findProject(input.id);
  if (!project) {
    return useCaseFailure("not_found", "Project not found", 404);
  }
  return ok({ project: store.toProjectDetail(project) });
}
