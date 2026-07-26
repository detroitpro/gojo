import { RunState } from "@shared/run-states";

import type { Database } from "@/storage";

export interface DashboardImpactQuery {
  projectId?: string | null;
  /** Inclusive ISO lower bound on run creation time. */
  from?: string | null;
  /** Inclusive ISO upper bound on run creation time. */
  to?: string | null;
}

export interface DashboardImpactTotals {
  succeededRuns: number;
  /** Integrations that produced a real PR (any current status). */
  prsOpened: number;
  /** PRs currently open (reconciler still tracking). */
  prsOpen: number;
  /** Runs whose canonical integration status is `merged`. */
  mergedRuns: number;
  /** PRs closed without merging. */
  closedUnmerged: number;
  /** Integrations that produced a commit. */
  commits: number;
  /** mergedRuns / all merge-intent integrations; null when nothing tracked. */
  mergeRate: number | null;
}

export interface DashboardImpactCategoryCount {
  category: string;
  verification: string;
  count: number;
}

export interface DashboardImpactRecentItem {
  id: string;
  runId: string;
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  category: string;
  subject: string;
  summary: string;
  source: string;
  verification: string;
  confidence: number | null;
  createdAt: string;
}

export interface DashboardImpact {
  totals: DashboardImpactTotals;
  categories: DashboardImpactCategoryCount[];
  recentItems: DashboardImpactRecentItem[];
}

const RECENT_ITEMS_LIMIT = 20;

function runFilter(query: DashboardImpactQuery): { clause: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];
  if (query.projectId) {
    conditions.push("r.project_id = ?");
    params.push(query.projectId);
  }
  if (query.from) {
    conditions.push("r.created_at >= ?");
    params.push(query.from);
  }
  if (query.to) {
    conditions.push("r.created_at <= ?");
    params.push(query.to);
  }
  return {
    clause: conditions.length > 0 ? ` AND ${conditions.join(" AND ")}` : "",
    params,
  };
}

/**
 * Aggregate canonical impact and integration outcomes in SQL.
 * Counts only persisted records — never raw handoff JSON or run states.
 */
export function getDashboardImpact(
  db: Database,
  query: DashboardImpactQuery = {},
): DashboardImpact {
  const sqlite = db.connection();
  const { clause, params } = runFilter(query);

  const succeededRuns =
    sqlite
      .query<{ count: number }, string[]>(
        `SELECT COUNT(*) AS count FROM runs r WHERE r.state = ?${clause}`,
      )
      .get(RunState.Succeeded, ...params)?.count ?? 0;

  const integrationTotals = sqlite
    .query<
      {
        prs_opened: number;
        prs_open: number;
        merged_runs: number;
        closed_unmerged: number;
        commits: number;
        merge_tracked: number;
      },
      string[]
    >(
      `SELECT
         COALESCE(SUM(CASE WHEN ri.pr_number IS NOT NULL THEN 1 ELSE 0 END), 0) AS prs_opened,
         COALESCE(SUM(CASE WHEN ri.status = 'open' THEN 1 ELSE 0 END), 0) AS prs_open,
         COALESCE(SUM(CASE WHEN ri.status = 'merged' THEN 1 ELSE 0 END), 0) AS merged_runs,
         COALESCE(SUM(CASE WHEN ri.status = 'closed' THEN 1 ELSE 0 END), 0) AS closed_unmerged,
         COALESCE(SUM(CASE WHEN ri.commit_sha IS NOT NULL THEN 1 ELSE 0 END), 0) AS commits,
         COALESCE(SUM(CASE WHEN ri.status IN ('open', 'merged', 'closed', 'conflict', 'failed') THEN 1 ELSE 0 END), 0) AS merge_tracked
       FROM run_integrations ri
       JOIN runs r ON r.id = ri.run_id
       WHERE 1 = 1${clause}`,
    )
    .get(...params);

  const mergedRuns = integrationTotals?.merged_runs ?? 0;
  const mergeTracked = integrationTotals?.merge_tracked ?? 0;

  const categories = sqlite
    .query<{ category: string; verification: string; count: number }, string[]>(
      `SELECT ii.category, ii.verification, COUNT(*) AS count
       FROM run_impact_items ii
       JOIN runs r ON r.id = ii.run_id
       WHERE 1 = 1${clause}
       GROUP BY ii.category, ii.verification
       ORDER BY ii.category, ii.verification`,
    )
    .all(...params);

  const recentItems = sqlite
    .query<
      {
        id: string;
        run_id: string;
        project_id: string;
        project_name: string;
        task_id: string;
        task_name: string;
        category: string;
        subject: string;
        summary: string;
        source: string;
        verification: string;
        confidence: number | null;
        created_at: string;
      },
      string[]
    >(
      `SELECT ii.id, ii.run_id, r.project_id, p.name AS project_name,
              r.task_id, t.name AS task_name,
              ii.category, ii.subject, ii.summary, ii.source, ii.verification,
              ii.confidence, ii.created_at
       FROM run_impact_items ii
       JOIN runs r ON r.id = ii.run_id
       JOIN projects p ON p.id = r.project_id
       JOIN tasks t ON t.id = r.task_id
       WHERE 1 = 1${clause}
       ORDER BY ii.created_at DESC, ii.id DESC
       LIMIT ${RECENT_ITEMS_LIMIT}`,
    )
    .all(...params);

  return {
    totals: {
      succeededRuns,
      prsOpened: integrationTotals?.prs_opened ?? 0,
      prsOpen: integrationTotals?.prs_open ?? 0,
      mergedRuns,
      closedUnmerged: integrationTotals?.closed_unmerged ?? 0,
      commits: integrationTotals?.commits ?? 0,
      mergeRate: mergeTracked > 0 ? mergedRuns / mergeTracked : null,
    },
    categories: categories.map((row) => ({
      category: row.category,
      verification: row.verification,
      count: row.count,
    })),
    recentItems: recentItems.map((row) => ({
      id: row.id,
      runId: row.run_id,
      projectId: row.project_id,
      projectName: row.project_name,
      taskId: row.task_id,
      taskName: row.task_name,
      category: row.category,
      subject: row.subject,
      summary: row.summary,
      source: row.source,
      verification: row.verification,
      confidence: row.confidence,
      createdAt: row.created_at,
    })),
  };
}
