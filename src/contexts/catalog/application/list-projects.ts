import { ok, type Result } from "@/kernel";
import {
  parsePageParams,
  parseSortParams,
  type PaginatedList,
} from "@shared/pagination";

import type { CatalogStore } from "../ports/catalog-store";
import type { ProjectListRow } from "../ports/catalog-store";

const SORT_ALLOWED = [
  "name",
  "createdAt",
  "updatedAt",
  "defaultBranch",
] as const;

export type ListProjectsInput = {
  limit?: string | number | null | undefined;
  offset?: string | number | null | undefined;
  sort?: string | null | undefined;
  order?: string | null | undefined;
  q?: string | null | undefined;
  hasOpenPrs?: string | boolean | null | undefined;
};

export async function listProjectsQuery(
  store: CatalogStore,
  input: ListProjectsInput,
): Promise<Result<PaginatedList<ProjectListRow> & { projects: ProjectListRow[] }>> {
  const page = parsePageParams({
    limit: input.limit != null ? String(input.limit) : null,
    offset: input.offset != null ? String(input.offset) : null,
  });
  const sort = parseSortParams(
    { sort: input.sort ?? null, order: input.order ?? null },
    { allowed: SORT_ALLOWED, defaultSort: "createdAt", defaultOrder: "asc" },
  );
  const raw = input.hasOpenPrs;
  const hasOpenPrs =
    raw === true || raw === "true" || raw === "1"
      ? true
      : raw === false || raw === "false" || raw === "0"
        ? false
        : null;
  const result = store.listProjects({
    ...page,
    ...sort,
    q: input.q ?? null,
    hasOpenPrs,
  });
  return ok({
    projects: result.items,
    items: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  });
}
