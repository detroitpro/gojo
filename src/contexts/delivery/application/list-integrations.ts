import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { ApprovalStore, IntegrationsPage } from "../ports/approval-store";

export type ListIntegrationsInput = {
  status: string | null;
  limit: number;
  offset: number;
  sort?: string | null;
  order?: "asc" | "desc" | null;
  projectId?: string | null;
  from?: string | null;
  to?: string | null;
};

export type ListIntegrationsDeps = { store: ApprovalStore };

const ALLOWED_STATUS = ["open", "merged", "committed"] as const;
type AllowedStatus = (typeof ALLOWED_STATUS)[number];

const ALLOWED_SORT = new Set([
  "openedAt",
  "mergedAt",
  "createdAt",
  "projectName",
  "agentName",
  "prNumber",
]);

export async function listIntegrationsQuery(
  deps: ListIntegrationsDeps,
  input: ListIntegrationsInput,
): Promise<Result<IntegrationsPage, UseCaseFailure>> {
  if (!input.status || !ALLOWED_STATUS.includes(input.status as AllowedStatus)) {
    return useCaseFailure(
      "validation_error",
      `status is required (${ALLOWED_STATUS.join("|")})`,
      400,
    );
  }
  const status = input.status as AllowedStatus;
  const defaultSort =
    status === "merged" ? "mergedAt" : status === "committed" ? "createdAt" : "openedAt";
  const sort = ALLOWED_SORT.has(input.sort ?? "") ? input.sort! : defaultSort;
  const order = input.order === "asc" ? "asc" : "desc";
  return ok(
    deps.store.listIntegrations({
      limit: input.limit,
      offset: input.offset,
      sort,
      order,
      status,
      projectId: input.projectId ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
    }),
  );
}
