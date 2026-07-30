import { RunState } from "@shared/run-states";

import type { Database } from "@/storage";

export type DashboardImpactRange = "30d" | "90d" | "all";

export interface DashboardImpactQuery {
  projectId?: string | null;
  /** Inclusive ISO lower bound on run creation time. */
  from?: string | null;
  /** Inclusive ISO upper bound on run creation time. */
  to?: string | null;
  /** Preferred over raw from/to when set; enables previousTotals. */
  range?: DashboardImpactRange | null;
}

export interface DashboardImpactWindow {
  from: string | null;
  to: string | null;
}

export interface DashboardImpactTotals {
  succeededRuns: number;
  /** Integrations that produced a real PR (any current status). */
  prsOpened: number;
  /** Source-current open PRs; stale last-known-open work is excluded. */
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

/**
 * Distinct runs that produced impact in a category.
 * Totals intentionally overlap across categories: a run that changed docs and
 * deps counts in both, so categoryTotals do not sum to a run total.
 */
export interface DashboardImpactCategoryTotal {
  category: string;
  runs: number;
}

export interface DashboardImpactRecentItem {
  id: string;
  runId: string;
  projectId: string;
  projectName: string;
  agentId: string;
  agentName: string;
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
  categoryTotals: DashboardImpactCategoryTotal[];
  recentItems: DashboardImpactRecentItem[];
  previousTotals: DashboardImpactTotals | null;
  window: DashboardImpactWindow;
  previousWindow: DashboardImpactWindow | null;
  range: DashboardImpactRange | null;
}

export function parseImpactRange(
  value: string | null | undefined,
): DashboardImpactRange | null {
  if (value === "30d" || value === "90d" || value === "all") return value;
  return null;
}

export function impactWindowsForRange(
  range: DashboardImpactRange,
  now = new Date(),
): {
  window: DashboardImpactWindow;
  previousWindow: DashboardImpactWindow | null;
} {
  if (range === "all") {
    return {
      window: { from: null, to: null },
      previousWindow: null,
    };
  }
  const days = range === "30d" ? 30 : 90;
  const ms = days * 24 * 60 * 60 * 1000;
  const to = now.toISOString();
  const from = new Date(now.getTime() - ms).toISOString();
  const previousTo = from;
  const previousFrom = new Date(now.getTime() - 2 * ms).toISOString();
  return {
    window: { from, to },
    previousWindow: { from: previousFrom, to: previousTo },
  };
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

function workFilter(query: DashboardImpactQuery): { clause: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];
  if (query.projectId) {
    conditions.push("wi.project_id = ?");
    params.push(query.projectId);
  }
  if (query.from) {
    conditions.push("wi.created_at >= ?");
    params.push(query.from);
  }
  if (query.to) {
    conditions.push("wi.created_at <= ?");
    params.push(query.to);
  }
  return {
    clause: conditions.length > 0 ? ` AND ${conditions.join(" AND ")}` : "",
    params,
  };
}

function computeImpactTotals(
  db: Database,
  query: DashboardImpactQuery,
): DashboardImpactTotals {
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
         COALESCE(SUM(CASE WHEN ri.status = 'open'
           AND ri.next_check_at IS NOT NULL
           AND ri.last_error IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM work_links wl
             JOIN work_items linked ON linked.id = wl.target_work_item_id
             WHERE wl.source_work_item_id = r.work_item_id
               AND wl.type = 'delivers'
               AND linked.kind = 'pull-request'
           )
           THEN 1 ELSE 0 END), 0) AS prs_open,
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
  const work = workFilter(query);
  const verifiedOpenPrs =
    sqlite
      .query<{ count: number }, string[]>(
        `SELECT COUNT(*) AS count
         FROM work_items wi
         WHERE wi.kind = 'pull-request'
           AND wi.delivery IN ('draft', 'open', 'review')
           AND wi.sync_state = 'current'
           AND wi.archived_at IS NULL${work.clause}`,
      )
      .get(...work.params)?.count ?? 0;

  return {
    succeededRuns,
    prsOpened: integrationTotals?.prs_opened ?? 0,
    prsOpen: verifiedOpenPrs + (integrationTotals?.prs_open ?? 0),
    mergedRuns,
    closedUnmerged: integrationTotals?.closed_unmerged ?? 0,
    commits: integrationTotals?.commits ?? 0,
    mergeRate: mergeTracked > 0 ? mergedRuns / mergeTracked : null,
  };
}

function computeCategoryTotals(
  db: Database,
  query: DashboardImpactQuery,
): DashboardImpactCategoryTotal[] {
  const sqlite = db.connection();
  const { clause, params } = runFilter(query);
  // Distinct runs per category (not rows): one lockfile + package + claim
  // still counts as 1. Rejected items are excluded. Categories overlap when
  // a run produced impact in more than one category.
  const rows = sqlite
    .query<{ category: string; runs: number }, string[]>(
      `SELECT ii.category, COUNT(DISTINCT ii.run_id) AS runs
       FROM run_impact_items ii
       JOIN runs r ON r.id = ii.run_id
       WHERE ii.verification <> 'rejected'${clause}
       GROUP BY ii.category
       ORDER BY runs DESC, ii.category`,
    )
    .all(...params);

  return rows.map((row) => ({
    category: row.category,
    runs: row.runs,
  }));
}

function computeRecentItems(
  db: Database,
  query: DashboardImpactQuery,
): DashboardImpactRecentItem[] {
  const sqlite = db.connection();
  const { clause, params } = runFilter(query);
  const recentItems = sqlite
    .query<
      {
        id: string;
        run_id: string;
        project_id: string;
        project_name: string;
        agent_id: string;
        agent_name: string;
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
              r.agent_id, a.name AS agent_name,
              ii.category, ii.subject, ii.summary, ii.source, ii.verification,
              ii.confidence, ii.created_at
       FROM run_impact_items ii
       JOIN runs r ON r.id = ii.run_id
       JOIN projects p ON p.id = r.project_id
       JOIN agents a ON a.id = r.agent_id
       WHERE 1 = 1${clause}
       ORDER BY ii.created_at DESC, ii.id DESC
       LIMIT ${RECENT_ITEMS_LIMIT}`,
    )
    .all(...params);

  return recentItems.map((row) => ({
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    projectName: row.project_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    category: row.category,
    subject: row.subject,
    summary: row.summary,
    source: row.source,
    verification: row.verification,
    confidence: row.confidence,
    createdAt: row.created_at,
  }));
}

/**
 * Aggregate canonical impact and integration outcomes in SQL.
 * Counts only persisted records — never raw handoff JSON or run states.
 * When `range` is set, also returns previousTotals for the prior equal-length window.
 */
export function getDashboardImpact(
  db: Database,
  query: DashboardImpactQuery = {},
): DashboardImpact {
  const range = query.range ?? null;
  if (range) {
    const { window, previousWindow } = impactWindowsForRange(range);
    const scoped =
      query.projectId !== undefined ? { projectId: query.projectId } : {};
    const currentQuery: DashboardImpactQuery = {
      ...scoped,
      from: window.from,
      to: window.to,
    };
    const previous = previousWindow
      ? computeImpactTotals(db, {
          ...scoped,
          from: previousWindow.from,
          to: previousWindow.to,
        })
      : null;
    return {
      totals: computeImpactTotals(db, currentQuery),
      categoryTotals: computeCategoryTotals(db, currentQuery),
      recentItems: computeRecentItems(db, currentQuery),
      previousTotals: previous,
      window,
      previousWindow,
      range,
    };
  }

  return {
    totals: computeImpactTotals(db, query),
    categoryTotals: computeCategoryTotals(db, query),
    recentItems: computeRecentItems(db, query),
    previousTotals: null,
    window: { from: query.from ?? null, to: query.to ?? null },
    previousWindow: null,
    range: null,
  };
}
