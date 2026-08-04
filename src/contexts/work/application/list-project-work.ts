import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";
import type {
  WorkAttention,
  WorkDelivery,
  WorkExecution,
  WorkOutcome,
  WorkProvenance,
} from "@shared/work";
import type { WorkPage } from "@/contexts/work/infrastructure/work-repositories";

import type { WorkStore } from "../ports/work-store";

export type ListProjectWorkInput = {
  projectId: string;
  limit: number;
  offset: number;
  kind?: string | null;
  provenance?: WorkProvenance | null;
  delivery?: WorkDelivery | null;
  attention?: WorkAttention | null;
  execution?: WorkExecution | null;
  outcome?: WorkOutcome | null;
  sourceId?: string | null;
  actor?: string | null;
  label?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  history?: boolean;
};

export type ListProjectWorkDeps = { store: WorkStore };

export async function listProjectWorkQuery(
  deps: ListProjectWorkDeps,
  input: ListProjectWorkInput,
): Promise<Result<WorkPage, UseCaseFailure>> {
  const { projectId, ...rest } = input;
  if (!deps.store.projectExists(projectId)) {
    return useCaseFailure("not_found", "Project not found", 404);
  }
  return ok(deps.store.listProjectItems(projectId, rest));
}
