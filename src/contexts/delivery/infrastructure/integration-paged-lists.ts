/** Delivery paged integrations list query. */
import type { SQLQueryBindings } from "bun:sqlite";

import type { PageParams, PaginatedList, SortParams } from "@shared/pagination";
import { parseSortParams } from "@shared/pagination";

import type { Database } from "@/infrastructure/persistence/db";
import { buildWhere, sqlOrderBy } from "@/infrastructure/persistence/sql-paging";
import {
  INTEGRATION_SORT_ALLOWED,
  defaultIntegrationSort,
  type IntegrationListItem,
  type IntegrationListStatus,
} from "@shared/list-api";

export { INTEGRATION_SORT_ALLOWED, defaultIntegrationSort };

export type { IntegrationListItem, IntegrationListStatus };
/** @deprecated Prefer IntegrationListItem from @shared/list-api */
export type IntegrationListRow = IntegrationListItem;

export type ListIntegrationsPageInput = PageParams &
  Partial<SortParams> & {
    status: IntegrationListStatus;
    projectId?: string | null;
    from?: string | null;
    to?: string | null;
  };

const ACTIVITY_AT_SQL = "COALESCE(ri.merged_at, ri.opened_at, r.created_at)";

export function listIntegrationsPage(
  db: Database,
  input: ListIntegrationsPageInput,
): PaginatedList<IntegrationListRow> {
  const sqlite = db.connection();
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (input.status === "committed") {
    clauses.push("ri.commit_sha IS NOT NULL");
  } else if (input.status === "all") {
    clauses.push("ri.status IN ('open', 'merged')");
    clauses.push("(ri.pr_url IS NOT NULL OR ri.pr_number IS NOT NULL)");
  } else {
    clauses.push("ri.status = ?");
    params.push(input.status);
    clauses.push("(ri.pr_url IS NOT NULL OR ri.pr_number IS NOT NULL)");
  }

  if (input.projectId) {
    buildWhere(clauses, params, "r.project_id = ?", input.projectId);
  }
  if (input.from) {
    buildWhere(clauses, params, "r.created_at >= ?", input.from);
  }
  if (input.to) {
    buildWhere(clauses, params, "r.created_at <= ?", input.to);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const from = `FROM run_integrations ri
    INNER JOIN runs r ON r.id = ri.run_id
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN agents a ON a.id = r.agent_id
    LEFT JOIN (
      SELECT run_id, branch_name,
             ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY attempt_number DESC) AS rn
      FROM attempts
    ) att ON att.run_id = r.id AND att.rn = 1`;

  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(
        `SELECT COUNT(*) AS count ${from} ${where}`,
      )
      .get(...params)?.count ?? 0;

  const { sort, order } = parseSortParams(
    { sort: input.sort, order: input.order },
    {
      allowed: INTEGRATION_SORT_ALLOWED,
      defaultSort: defaultIntegrationSort(input.status),
      defaultOrder: "desc",
    },
  );
  const orderBy = sqlOrderBy(
    sort,
    order,
    {
      activityAt: ACTIVITY_AT_SQL,
      openedAt: "ri.opened_at",
      mergedAt: "ri.merged_at",
      createdAt: "r.created_at",
      projectName: "p.name COLLATE NOCASE",
      agentName: "a.name COLLATE NOCASE",
      prNumber: "ri.pr_number",
    },
    "ri.id DESC",
  );

  type IntegrationSqlRow = {
    run_id: string;
    project_id: string;
    project_name: string | null;
    agent_id: string;
    agent_name: string | null;
    pr_number: number | null;
    pr_url: string | null;
    provider: string | null;
    repo: string | null;
    status: string;
    commit_sha: string | null;
    opened_at: string | null;
    merged_at: string | null;
    last_checked_at: string | null;
    last_error: string | null;
    branch_name: string | null;
    run_created_at: string;
  };

  const rows = sqlite
    .query(
      `SELECT
         r.id AS run_id,
         r.project_id AS project_id,
         p.name AS project_name,
         r.agent_id AS agent_id,
         a.name AS agent_name,
         ri.pr_number AS pr_number,
         ri.pr_url AS pr_url,
         ri.provider AS provider,
         ri.repo AS repo,
         ri.status AS status,
         ri.commit_sha AS commit_sha,
         ri.opened_at AS opened_at,
         ri.merged_at AS merged_at,
         ri.last_checked_at AS last_checked_at,
         ri.last_error AS last_error,
         att.branch_name AS branch_name,
         r.created_at AS run_created_at
       ${from}
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset) as IntegrationSqlRow[];

  return {
    items: rows.map((row) => ({
      runId: row.run_id,
      projectId: row.project_id,
      projectName: row.project_name,
      agentId: row.agent_id,
      agentName: row.agent_name,
      prNumber: row.pr_number,
      prUrl: row.pr_url,
      provider: row.provider,
      repo: row.repo,
      status: row.status,
      commitSha: row.commit_sha,
      openedAt: row.opened_at,
      mergedAt: row.merged_at,
      lastCheckedAt: row.last_checked_at,
      lastError: row.last_error,
      branchName: row.branch_name,
      runCreatedAt: row.run_created_at,
    })),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}
