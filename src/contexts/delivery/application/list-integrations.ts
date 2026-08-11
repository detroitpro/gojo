import { ok, type Result } from "@/kernel";
import {
  INTEGRATION_LIST_STATUSES,
  INTEGRATION_SORT_ALLOWED,
  defaultIntegrationSort,
  type IntegrationListStatus,
} from "@shared/list-api";
import { parsePageParams, parseSortParams } from "@shared/pagination";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { ApprovalStore, IntegrationsPage } from "../ports/approval-store";

export type ListIntegrationsInput = {
  status: string | null;
  limit?: string | number | null;
  offset?: string | number | null;
  sort?: string | null;
  order?: "asc" | "desc" | null;
  projectId?: string | null;
  from?: string | null;
  to?: string | null;
};

export type ListIntegrationsDeps = { store: ApprovalStore };

const ALLOWED_STATUS = new Set<string>(INTEGRATION_LIST_STATUSES);

export async function listIntegrationsQuery(
  deps: ListIntegrationsDeps,
  input: ListIntegrationsInput,
): Promise<Result<IntegrationsPage, UseCaseFailure>> {
  const rawStatus = input.status?.trim() || "all";
  if (!ALLOWED_STATUS.has(rawStatus)) {
    return useCaseFailure(
      "validation_error",
      `status must be one of ${INTEGRATION_LIST_STATUSES.join("|")}`,
      400,
    );
  }
  const status = rawStatus as IntegrationListStatus;
  const page = parsePageParams({
    limit: input.limit != null ? String(input.limit) : null,
    offset: input.offset != null ? String(input.offset) : null,
  });
  const { sort, order } = parseSortParams(
    { sort: input.sort ?? null, order: input.order ?? null },
    {
      allowed: INTEGRATION_SORT_ALLOWED,
      defaultSort: defaultIntegrationSort(status),
      defaultOrder: "desc",
    },
  );
  return ok(
    deps.store.listIntegrations({
      ...page,
      sort,
      order,
      status,
      projectId: input.projectId ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
    }),
  );
}
