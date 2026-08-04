import { ok, type Result } from "@/kernel";
import {
  parsePageParams,
  parseSortParams,
  type PaginatedList,
} from "@shared/pagination";

import type { CatalogStore } from "../ports/catalog-store";
import type { ScheduleListRow } from "../ports/catalog-store";

const SORT_ALLOWED = [
  "name",
  "projectName",
  "cronExpr",
  "nextRunAt",
  "lastRunAt",
  "enabled",
  "createdAt",
] as const;

export type ListSchedulesInput = {
  limit?: string | number | null | undefined;
  offset?: string | number | null | undefined;
  sort?: string | null | undefined;
  order?: string | null | undefined;
  projectId?: string | null | undefined;
  agentId?: string | null | undefined;
  enabled?: string | null | undefined;
  q?: string | null | undefined;
};

function parseEnabledParam(value: string | null | undefined): boolean | null {
  if (value == null || value === "" || value === "all") return null;
  if (value === "true" || value === "1" || value === "enabled") return true;
  if (value === "false" || value === "0" || value === "disabled") return false;
  return null;
}

export async function listSchedulesQuery(
  store: CatalogStore,
  input: ListSchedulesInput,
): Promise<
  Result<PaginatedList<ScheduleListRow> & { schedules: ScheduleListRow[] }>
> {
  const page = parsePageParams({
    limit: input.limit != null ? String(input.limit) : null,
    offset: input.offset != null ? String(input.offset) : null,
  });
  const sort = parseSortParams(
    { sort: input.sort ?? null, order: input.order ?? null },
    { allowed: SORT_ALLOWED, defaultSort: "createdAt", defaultOrder: "asc" },
  );
  const result = store.listSchedules({
    ...page,
    ...sort,
    projectId: input.projectId ?? null,
    agentId: input.agentId ?? null,
    enabled: parseEnabledParam(input.enabled),
    q: input.q ?? null,
  });
  return ok({
    schedules: result.items,
    items: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  });
}
