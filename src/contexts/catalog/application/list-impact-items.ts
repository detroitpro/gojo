import { ok, type Result } from "@/kernel";
import {
  parsePageParams,
  parseSortParams,
  type PaginatedList,
} from "@shared/pagination";

import type { CatalogStore } from "../ports/catalog-store";
import type { ImpactItemListRow } from "../ports/catalog-store";

const SORT_ALLOWED = [
  "createdAt",
  "category",
  "subject",
  "projectName",
  "agentName",
] as const;

export type ListImpactItemsInput = {
  limit?: string | number | null | undefined;
  offset?: string | number | null | undefined;
  sort?: string | null | undefined;
  order?: string | null | undefined;
  category?: string | null | undefined;
  projectId?: string | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
};

export async function listImpactItemsQuery(
  store: CatalogStore,
  input: ListImpactItemsInput,
): Promise<
  Result<PaginatedList<ImpactItemListRow> & { items: ImpactItemListRow[] }>
> {
  const page = parsePageParams({
    limit: input.limit != null ? String(input.limit) : null,
    offset: input.offset != null ? String(input.offset) : null,
  });
  const sort = parseSortParams(
    { sort: input.sort ?? null, order: input.order ?? null },
    { allowed: SORT_ALLOWED, defaultSort: "createdAt", defaultOrder: "desc" },
  );
  const result = store.listImpactItems({
    ...page,
    ...sort,
    category: input.category ?? null,
    projectId: input.projectId ?? null,
    from: input.from ?? null,
    to: input.to ?? null,
  });
  return ok({
    items: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  });
}
