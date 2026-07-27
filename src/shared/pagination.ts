export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

export type PageParams = {
  limit: number;
  offset: number;
};

export type PaginatedList<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type PageQueryInput = {
  limit?: string | null;
  offset?: string | null;
};

export type SortOrder = "asc" | "desc";

export type SortParams = {
  sort: string;
  order: SortOrder;
};

export type SortQueryInput = {
  sort?: string | null | undefined;
  order?: string | null | undefined;
};

export type ParseSortParamsOptions = {
  allowed: readonly string[];
  defaultSort: string;
  defaultOrder?: SortOrder;
};

function parseNonNegativeInt(value: string | null | undefined, fallback: number): number {
  if (value == null || value.trim() === "") {
    return fallback;
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return n;
}

/** Parse and clamp limit/offset from query-string style inputs. */
export function parsePageParams(input: PageQueryInput = {}): PageParams {
  const rawLimit = parseNonNegativeInt(input.limit, DEFAULT_PAGE_LIMIT);
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, rawLimit === 0 ? DEFAULT_PAGE_LIMIT : rawLimit));
  const offset = parseNonNegativeInt(input.offset, 0);
  return { limit, offset };
}

export function parsePageParamsFromUrl(url: URL): PageParams {
  return parsePageParams({
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  });
}

/** Parse sort/order from query input; unknown sort falls back to default. */
export function parseSortParams(
  input: SortQueryInput,
  options: ParseSortParamsOptions,
): SortParams {
  const defaultOrder = options.defaultOrder ?? "asc";
  const sort =
    input.sort && options.allowed.includes(input.sort) ? input.sort : options.defaultSort;
  const rawOrder = input.order?.trim().toLowerCase();
  const order: SortOrder = rawOrder === "asc" || rawOrder === "desc" ? rawOrder : defaultOrder;
  return { sort, order };
}

export function parseSortParamsFromUrl(url: URL, options: ParseSortParamsOptions): SortParams {
  return parseSortParams(
    {
      sort: url.searchParams.get("sort"),
      order: url.searchParams.get("order"),
    },
    options,
  );
}

/** Compare two values for client/memory sorts (nulls last). */
export function compareSortValues(a: unknown, b: unknown, order: SortOrder): number {
  const dir = order === "asc" ? 1 : -1;
  if (a == null && b == null) {
    return 0;
  }
  if (a == null) {
    return 1;
  }
  if (b == null) {
    return -1;
  }
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * dir;
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return (Number(a) - Number(b)) * dir;
  }
  const as = String(a);
  const bs = String(b);
  return as.localeCompare(bs, undefined, { sensitivity: "base", numeric: true }) * dir;
}

export function paginateArray<T>(items: readonly T[], page: PageParams): PaginatedList<T> {
  const total = items.length;
  const sliced = items.slice(page.offset, page.offset + page.limit);
  return {
    items: sliced,
    total,
    limit: page.limit,
    offset: page.offset,
  };
}

export function rangeLabel(total: number, limit: number, offset: number): string {
  if (total <= 0) {
    return "Showing 0 of 0";
  }
  const start = Math.min(offset + 1, total);
  const end = Math.min(offset + limit, total);
  return `Showing ${start}–${end} of ${total}`;
}

export function pageCount(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, limit)));
}
