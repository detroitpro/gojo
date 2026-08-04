/** Shared SQL paging helpers for context-owned list queries. */
import type { SQLQueryBindings } from "bun:sqlite";

import type { SortOrder } from "@shared/pagination";

export function likePattern(q: string): string {
  return `%${q.replace(/[%_]/g, "\$&")}%`;
}

export function buildWhere(
  clauses: string[],
  params: SQLQueryBindings[],
  clause: string,
  value: SQLQueryBindings,
): void {
  clauses.push(clause);
  params.push(value);
}

export function manifestIsPresent(manifestJson: string | null | undefined): boolean {
  const trimmed = (manifestJson ?? "").trim();
  return trimmed.length > 0 && trimmed !== "{}";
}

export function sqlOrderBy(
  sort: string,
  order: SortOrder,
  columns: Record<string, string>,
  tieBreaker: string,
): string {
  const expr = columns[sort];
  if (!expr) {
    throw new Error(`Unmapped sort column: ${sort}`);
  }
  const dir = order === "asc" ? "ASC" : "DESC";
  return `ORDER BY ${expr} ${dir}, ${tieBreaker}`;
}

/** Open gojo-tracked PR count correlated on projects alias `p`. */
export const OPEN_PR_COUNT_SQL = `(
  (SELECT COUNT(*) FROM work_items wi
    WHERE wi.project_id = p.id
      AND wi.kind = 'pull-request'
      AND wi.delivery IN ('draft', 'open', 'review')
      AND wi.sync_state = 'current'
      AND wi.archived_at IS NULL)
  +
  (SELECT COUNT(*) FROM run_integrations ri
    INNER JOIN runs r ON r.id = ri.run_id
    WHERE r.project_id = p.id
      AND ri.status = 'open'
      AND ri.next_check_at IS NOT NULL
      AND ri.last_error IS NULL
      AND (ri.pr_url IS NOT NULL OR ri.pr_number IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM work_links wl
        INNER JOIN work_items linked ON linked.id = wl.target_work_item_id
        WHERE wl.source_work_item_id = r.work_item_id
          AND wl.type = 'delivers'
          AND linked.kind = 'pull-request'
      ))
)`;
