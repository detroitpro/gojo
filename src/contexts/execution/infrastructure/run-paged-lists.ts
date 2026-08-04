/** Execution paged run list query. */
import type { SQLQueryBindings } from "bun:sqlite";

import type { PageParams, PaginatedList, SortParams } from "@shared/pagination";
import { parseSortParams } from "@shared/pagination";

import type { Database } from "@/infrastructure/persistence/db";
import { mapRun } from "@/contexts/execution/infrastructure/run-repositories";
import type { Run, RunTrigger } from "@/infrastructure/persistence/types";
import type { RunState } from "@shared/run-states";
import { likePattern, buildWhere, sqlOrderBy } from "@/infrastructure/persistence/sql-paging";
import { RUN_SORT_ALLOWED } from "@shared/list-api";

export type ListRunsPageInput = PageParams &
  Partial<SortParams> & {
    projectId?: string | null;
    agentId?: string | null;
    state?: string | null;
    trigger?: string | null;
    q?: string | null;
    from?: string | null;
    to?: string | null;
  };

export type RunListRow = Run & {
  projectName: string | null;
  agentName: string | null;
};

type SqlRunRow = {
  id: string;
  project_id: string;
  agent_id: string;
  schedule_id: string | null;
  state: string;
  idempotency_key: string;
  trigger: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  not_before_at: string | null;
  expires_at: string | null;
  admitted_at: string | null;
  priority: number;
  work_item_id: string | null;
  project_name: string | null;
  agent_name: string | null;
};

export function listRunsPage(
  db: Database,
  input: ListRunsPageInput,
): PaginatedList<RunListRow> {
  const sqlite = db.connection();
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (input.projectId) {
    buildWhere(clauses, params, "r.project_id = ?", input.projectId);
  }
  if (input.agentId) {
    buildWhere(clauses, params, "r.agent_id = ?", input.agentId);
  }
  if (input.state) {
    buildWhere(clauses, params, "r.state = ?", input.state);
  }
  if (input.trigger) {
    buildWhere(clauses, params, "r.trigger = ?", input.trigger);
  }
  if (input.from) {
    buildWhere(clauses, params, "r.created_at >= ?", input.from);
  }
  if (input.to) {
    buildWhere(clauses, params, "r.created_at <= ?", input.to);
  }
  const q = input.q?.trim();
  if (q) {
    const pattern = likePattern(q);
    clauses.push(
      `(r.id LIKE ? ESCAPE '\\' OR r.project_id LIKE ? ESCAPE '\\' OR r.agent_id LIKE ? ESCAPE '\\' OR IFNULL(p.name,'') LIKE ? ESCAPE '\\' OR IFNULL(a.name,'') LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const from = `FROM runs r
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN agents a ON a.id = r.agent_id`;

  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(`SELECT COUNT(*) AS count ${from} ${where}`)
      .get(...params)?.count ?? 0;

  const { sort, order } = parseSortParams(
    { sort: input.sort, order: input.order },
    { allowed: RUN_SORT_ALLOWED, defaultSort: "createdAt", defaultOrder: "desc" },
  );
  const orderBy = sqlOrderBy(
    sort,
    order,
    {
      createdAt: "r.created_at",
      finishedAt: "r.finished_at",
      state: "r.state",
      trigger: "r.trigger",
      agentName: "IFNULL(a.name, '') COLLATE NOCASE",
      projectName: "IFNULL(p.name, '') COLLATE NOCASE",
    },
    "r.id ASC",
  );

  const rows = sqlite
    .query<SqlRunRow, SQLQueryBindings[]>(
      `SELECT r.*, p.name AS project_name, a.name AS agent_name
       ${from} ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset);

  return {
    items: rows.map((row) => ({
      ...mapRun({
        ...row,
        state: row.state as RunState,
        trigger: row.trigger as RunTrigger,
      }),
      projectName: row.project_name,
      agentName: row.agent_name,
    })),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

