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
  agentId?: string;
  state?: string;
  status?: string;
  trigger?: string;
  category?: string;
  subjectType?: string;
  /** Inclusive ISO lower bound (run created_at). */
  from?: string;
  /** Inclusive ISO upper bound (run created_at). */
  to?: string;
  enabled?: "all" | "enabled" | "disabled" | "true" | "false" | boolean;
  hasOpenPrs?: boolean;
  sort?: string;
  order?: SortOrder;
  /** Project work history view (completed / verified-terminal / operator-resolved). */
  history?: boolean;
  /** Work kind filter (e.g. issue, pull-request, run). */
  kind?: string;
  /** Work delivery filter (e.g. open, closed, merged). */
  delivery?: string;
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
  if (params.agentId) {
    sp.set("agentId", params.agentId);
  }
  if (params.state) {
    sp.set("state", params.state);
  }
  if (params.status) {
    sp.set("status", params.status);
  }
  if (params.trigger) {
    sp.set("trigger", params.trigger);
  }
  if (params.category) {
    sp.set("category", params.category);
  }
  if (params.subjectType) {
    sp.set("subjectType", params.subjectType);
  }
  if (params.from) {
    sp.set("from", params.from);
  }
  if (params.to) {
    sp.set("to", params.to);
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
  if (params.history === true) {
    sp.set("history", "1");
  }
  if (params.kind) {
    sp.set("kind", params.kind);
  }
  if (params.delivery) {
    sp.set("delivery", params.delivery);
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
