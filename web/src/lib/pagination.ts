export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

export type PageParams = {
  limit: number;
  offset: number;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type SortOrder = "asc" | "desc";

export type ListQuery = {
  limit?: number;
  offset?: number;
  q?: string;
  projectId?: string;
  taskId?: string;
  state?: string;
  trigger?: string;
  enabled?: "all" | "enabled" | "disabled" | "true" | "false" | boolean;
  hasOpenPrs?: boolean;
  sort?: string;
  order?: SortOrder;
};

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

export function buildListQuery(params: ListQuery): string {
  const sp = new URLSearchParams();
  if (params.limit != null) {
    sp.set("limit", String(params.limit));
  }
  if (params.offset != null) {
    sp.set("offset", String(params.offset));
  }
  if (params.q?.trim()) {
    sp.set("q", params.q.trim());
  }
  if (params.projectId) {
    sp.set("projectId", params.projectId);
  }
  if (params.taskId) {
    sp.set("taskId", params.taskId);
  }
  if (params.state) {
    sp.set("state", params.state);
  }
  if (params.trigger) {
    sp.set("trigger", params.trigger);
  }
  if (params.enabled !== undefined && params.enabled !== "all") {
    if (params.enabled === true || params.enabled === "enabled" || params.enabled === "true") {
      sp.set("enabled", "true");
    } else if (
      params.enabled === false ||
      params.enabled === "disabled" ||
      params.enabled === "false"
    ) {
      sp.set("enabled", "false");
    }
  }
  if (params.hasOpenPrs === true) {
    sp.set("hasOpenPrs", "true");
  }
  if (params.sort) {
    sp.set("sort", params.sort);
  }
  if (params.order) {
    sp.set("order", params.order);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function paginateArray<T>(items: readonly T[], limit: number, offset: number): PaginatedResult<T> {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}
