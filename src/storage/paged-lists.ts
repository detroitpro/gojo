import { existsSync } from "node:fs";
import { join } from "node:path";

import type { SQLQueryBindings } from "bun:sqlite";

import type { PageParams, PaginatedList, SortOrder, SortParams } from "@shared/pagination";
import { parseSortParams } from "@shared/pagination";
import type { RunState } from "@shared/run-states";

import { describeCron } from "@shared/cron-describe";
import type { Database } from "@/storage";
import { createRepositories } from "@/storage";
import type { DashboardOverviewRun } from "@/storage/dashboard-overview";
import type { Project, Run, RunTrigger, Schedule, Task } from "@/storage/types";
import { mapProject, mapRun, mapSchedule, mapTask } from "@/storage/repositories";

export const PROJECT_SORT_ALLOWED = ["name", "createdAt", "updatedAt", "defaultBranch"] as const;
export const TASK_SORT_ALLOWED = [
  "name",
  "projectName",
  "enabled",
  "createdAt",
  "lastRunAt",
  /** Share of Succeeded among the last 5 runs (same window as the Success column). */
  "successRate",
] as const;
export const RUN_SORT_ALLOWED = [
  "createdAt",
  "finishedAt",
  "state",
  "trigger",
  "taskName",
  "projectName",
] as const;
export const SCHEDULE_SORT_ALLOWED = [
  "name",
  "projectName",
  "cronExpr",
  "nextRunAt",
  "lastRunAt",
  "enabled",
  "createdAt",
] as const;
export const QUEUE_SORT_ALLOWED = [
  "position",
  "priority",
  "notBeforeAt",
  "expiresAt",
  "projectName",
  "taskName",
] as const;
export const TOKEN_SORT_ALLOWED = ["name", "createdAt", "expiresAt"] as const;
export const BACKUP_SORT_ALLOWED = ["name", "createdAt"] as const;
export const INTEGRATION_LIST_STATUSES = ["open", "merged"] as const;
export type IntegrationListStatus = (typeof INTEGRATION_LIST_STATUSES)[number];

export const INTEGRATION_SORT_ALLOWED = [
  "openedAt",
  "mergedAt",
  "projectName",
  "taskName",
  "prNumber",
] as const;

export type ListProjectsPageInput = PageParams &
  Partial<SortParams> & {
    q?: string | null;
    /** When true, only projects with currently-open gojo-tracked PRs. */
    hasOpenPrs?: boolean | null;
  };

export type ListIntegrationsPageInput = PageParams &
  Partial<SortParams> & {
    status: IntegrationListStatus;
    projectId?: string | null;
  };

export type IntegrationListRow = {
  runId: string;
  projectId: string;
  projectName: string | null;
  taskId: string;
  taskName: string | null;
  prNumber: number | null;
  prUrl: string | null;
  provider: string | null;
  repo: string | null;
  status: IntegrationListStatus;
  openedAt: string | null;
  mergedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  branchName: string | null;
};

export type ListTasksPageInput = PageParams &
  Partial<SortParams> & {
    projectId?: string | null;
    enabled?: boolean | null;
    q?: string | null;
  };

export type ListRunsPageInput = PageParams &
  Partial<SortParams> & {
    projectId?: string | null;
    taskId?: string | null;
    state?: string | null;
    trigger?: string | null;
    q?: string | null;
  };

export type ListSchedulesPageInput = PageParams &
  Partial<SortParams> & {
    projectId?: string | null;
    taskId?: string | null;
    enabled?: boolean | null;
    q?: string | null;
  };

export type TaskSourceInfo = {
  repoPath: string;
  manifestPath: string | null;
  promptFile: string | null;
  promptAbsolutePath: string | null;
};

/** Task detail: list enrichments + YAML/prompt provenance for ops (not an editor). */
export type TaskDetailRow = TaskListRow & {
  source: TaskSourceInfo;
};

/** Map whitelist sort key → SQL expression (never pass raw client strings). */
function sqlOrderBy(
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

export type RunListRow = Run & {
  projectName: string | null;
  taskName: string | null;
};

export type TaskListRow = Task & {
  projectName: string | null;
  agentProfileName: string | null;
  lastRunId: string | null;
  lastRunState: string | null;
  lastRunCreatedAt: string | null;
  /** Up to 5 recent runs, oldest → newest (same shape as dashboard overview). */
  recentRuns: DashboardOverviewRun[];
};

export type ScheduleListRow = Schedule & {
  taskName: string | null;
  projectId: string | null;
  projectName: string | null;
  cronDescription: string;
};

export type ProjectSummaryCounts = {
  taskCount: number;
  enabledTaskCount: number;
  scheduleCount: number;
  enabledScheduleCount: number;
  hasManifest: boolean;
  /** Source-verified open PRs; stale last-known-open resources are excluded. */
  openPrCount: number;
};

const OPEN_PR_COUNT_SQL = `(
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

/** List row: summary counts, no heavy manifest blob. */
export type ProjectListRow = Omit<Project, "manifestJson"> &
  ProjectSummaryCounts & {
    manifestJson?: undefined;
  };

/** Detail row: full project + summary counts. */
export type ProjectDetailRow = Project & ProjectSummaryCounts;

type SqlRunRow = {
  id: string;
  project_id: string;
  task_id: string;
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
  task_name: string | null;
};

type SqlTaskRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  prompt: string;
  agent_profile_id: string | null;
  validation_profile_json: string;
  integration_json: string;
  failure_policy_json: string;
  concurrency_json: string;
  notifications_json: string;
  enabled: number;
  created_at: string;
  project_name: string | null;
  agent_profile_name: string | null;
  last_run_id: string | null;
  last_run_state: string | null;
  last_run_created_at: string | null;
};

type SqlScheduleRow = {
  id: string;
  task_id: string;
  name: string;
  cron_expr: string;
  timezone: string;
  enabled: number;
  overlap_policy: string;
  missed_run_policy: string;
  retry_json: string;
  consecutive_failures: number;
  disable_after: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  task_name: string | null;
  project_id: string | null;
  project_name: string | null;
};

function likePattern(q: string): string {
  return `%${q.replace(/[%_]/g, "\\$&")}%`;
}

function buildWhere(
  clauses: string[],
  params: SQLQueryBindings[],
  clause: string,
  value: SQLQueryBindings,
): void {
  clauses.push(clause);
  params.push(value);
}

function manifestIsPresent(manifestJson: string | null | undefined): boolean {
  const trimmed = (manifestJson ?? "").trim();
  return trimmed.length > 0 && trimmed !== "{}";
}

export function projectSummaryFor(
  db: Database,
  projectId: string,
): ProjectSummaryCounts | null {
  const sqlite = db.connection();
  const row = sqlite
    .query<
      {
        manifest_json: string;
        task_count: number;
        enabled_task_count: number;
        schedule_count: number;
        enabled_schedule_count: number;
        open_pr_count: number;
      },
      [string]
    >(
      `SELECT
         p.manifest_json AS manifest_json,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.enabled = 1) AS enabled_task_count,
         (SELECT COUNT(*) FROM schedules s
            INNER JOIN tasks t ON t.id = s.task_id
            WHERE t.project_id = p.id) AS schedule_count,
         (SELECT COUNT(*) FROM schedules s
            INNER JOIN tasks t ON t.id = s.task_id
            WHERE t.project_id = p.id AND s.enabled = 1) AS enabled_schedule_count,
         ${OPEN_PR_COUNT_SQL} AS open_pr_count
       FROM projects p
       WHERE p.id = ?`,
    )
    .get(projectId);
  if (!row) {
    return null;
  }
  return {
    taskCount: row.task_count,
    enabledTaskCount: row.enabled_task_count,
    scheduleCount: row.schedule_count,
    enabledScheduleCount: row.enabled_schedule_count,
    hasManifest: manifestIsPresent(row.manifest_json),
    openPrCount: row.open_pr_count,
  };
}

export function toProjectDetailRow(
  db: Database,
  project: Project,
): ProjectDetailRow {
  const summary = projectSummaryFor(db, project.id) ?? {
    taskCount: 0,
    enabledTaskCount: 0,
    scheduleCount: 0,
    enabledScheduleCount: 0,
    hasManifest: manifestIsPresent(project.manifestJson),
    openPrCount: 0,
  };
  return { ...project, ...summary };
}

export function listProjectsPage(
  db: Database,
  input: ListProjectsPageInput,
): PaginatedList<ProjectListRow> {
  const sqlite = db.connection();
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  const q = input.q?.trim();
  if (q) {
    buildWhere(
      clauses,
      params,
      `(p.name LIKE ? ESCAPE '\\' OR p.repo_path LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\')`,
      likePattern(q),
    );
    params.push(likePattern(q), likePattern(q));
  }
  if (input.hasOpenPrs === true) {
    clauses.push(`${OPEN_PR_COUNT_SQL} > 0`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(
        `SELECT COUNT(*) AS count FROM projects p ${where}`,
      )
      .get(...params)?.count ?? 0;

  type ProjectListSqlRow = Parameters<typeof mapProject>[0] & {
    task_count: number;
    enabled_task_count: number;
    schedule_count: number;
    enabled_schedule_count: number;
    open_pr_count: number;
  };

  const { sort, order } = parseSortParams(
    { sort: input.sort, order: input.order },
    { allowed: PROJECT_SORT_ALLOWED, defaultSort: "createdAt", defaultOrder: "asc" },
  );
  const orderBy = sqlOrderBy(
    sort,
    order,
    {
      name: "p.name COLLATE NOCASE",
      createdAt: "p.created_at",
      updatedAt: "p.updated_at",
      defaultBranch: "p.default_branch COLLATE NOCASE",
    },
    "p.id ASC",
  );

  const rows = sqlite
    .query(
      `SELECT
         p.id, p.name, p.repo_path, p.remote_url, p.default_branch,
         p.manifest_json, p.created_at, p.updated_at,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.enabled = 1) AS enabled_task_count,
         (SELECT COUNT(*) FROM schedules s
            INNER JOIN tasks t ON t.id = s.task_id
            WHERE t.project_id = p.id) AS schedule_count,
         (SELECT COUNT(*) FROM schedules s
            INNER JOIN tasks t ON t.id = s.task_id
            WHERE t.project_id = p.id AND s.enabled = 1) AS enabled_schedule_count,
         ${OPEN_PR_COUNT_SQL} AS open_pr_count
       FROM projects p
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset) as ProjectListSqlRow[];

  return {
    items: rows.map((row) => {
      const project = mapProject(row);
      return {
        id: project.id,
        name: project.name,
        repoPath: project.repoPath,
        remoteUrl: project.remoteUrl,
        defaultBranch: project.defaultBranch,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        taskCount: row.task_count,
        enabledTaskCount: row.enabled_task_count,
        scheduleCount: row.schedule_count,
        enabledScheduleCount: row.enabled_schedule_count,
        hasManifest: manifestIsPresent(row.manifest_json),
        openPrCount: row.open_pr_count,
      };
    }),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

export function listIntegrationsPage(
  db: Database,
  input: ListIntegrationsPageInput,
): PaginatedList<IntegrationListRow> {
  const sqlite = db.connection();
  const clauses: string[] = [
    "ri.status = ?",
    "(ri.pr_url IS NOT NULL OR ri.pr_number IS NOT NULL)",
  ];
  const params: SQLQueryBindings[] = [input.status];

  if (input.projectId) {
    buildWhere(clauses, params, "r.project_id = ?", input.projectId);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const from = `FROM run_integrations ri
    INNER JOIN runs r ON r.id = ri.run_id
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN tasks t ON t.id = r.task_id
    LEFT JOIN (
      SELECT run_id, branch_name,
             ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY attempt_number DESC) AS rn
      FROM attempts
    ) a ON a.run_id = r.id AND a.rn = 1`;

  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(
        `SELECT COUNT(*) AS count ${from} ${where}`,
      )
      .get(...params)?.count ?? 0;

  const defaultSort = input.status === "merged" ? "mergedAt" : "openedAt";
  const { sort, order } = parseSortParams(
    { sort: input.sort, order: input.order },
    {
      allowed: INTEGRATION_SORT_ALLOWED,
      defaultSort,
      defaultOrder: "desc",
    },
  );
  const orderBy = sqlOrderBy(
    sort,
    order,
    {
      openedAt: "ri.opened_at",
      mergedAt: "ri.merged_at",
      projectName: "p.name COLLATE NOCASE",
      taskName: "t.name COLLATE NOCASE",
      prNumber: "ri.pr_number",
    },
    "ri.id DESC",
  );

  type IntegrationSqlRow = {
    run_id: string;
    project_id: string;
    project_name: string | null;
    task_id: string;
    task_name: string | null;
    pr_number: number | null;
    pr_url: string | null;
    provider: string | null;
    repo: string | null;
    status: string;
    opened_at: string | null;
    merged_at: string | null;
    last_checked_at: string | null;
    last_error: string | null;
    branch_name: string | null;
  };

  const rows = sqlite
    .query(
      `SELECT
         r.id AS run_id,
         r.project_id AS project_id,
         p.name AS project_name,
         r.task_id AS task_id,
         t.name AS task_name,
         ri.pr_number AS pr_number,
         ri.pr_url AS pr_url,
         ri.provider AS provider,
         ri.repo AS repo,
         ri.status AS status,
         ri.opened_at AS opened_at,
         ri.merged_at AS merged_at,
         ri.last_checked_at AS last_checked_at,
         ri.last_error AS last_error,
         a.branch_name AS branch_name
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
      taskId: row.task_id,
      taskName: row.task_name,
      prNumber: row.pr_number,
      prUrl: row.pr_url,
      provider: row.provider,
      repo: row.repo,
      status: row.status as IntegrationListStatus,
      openedAt: row.opened_at,
      mergedAt: row.merged_at,
      lastCheckedAt: row.last_checked_at,
      lastError: row.last_error,
      branchName: row.branch_name,
    })),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

export function listTasksPage(
  db: Database,
  input: ListTasksPageInput,
): PaginatedList<TaskListRow> {
  const sqlite = db.connection();
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (input.projectId) {
    buildWhere(clauses, params, "t.project_id = ?", input.projectId);
  }
  if (input.enabled === true) {
    buildWhere(clauses, params, "t.enabled = ?", 1);
  } else if (input.enabled === false) {
    buildWhere(clauses, params, "t.enabled = ?", 0);
  }
  const q = input.q?.trim();
  if (q) {
    const pattern = likePattern(q);
    clauses.push(
      `(t.name LIKE ? ESCAPE '\\' OR t.id LIKE ? ESCAPE '\\' OR IFNULL(t.description,'') LIKE ? ESCAPE '\\' OR IFNULL(p.name,'') LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern, pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const from = `FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN agent_profiles a ON a.id = t.agent_profile_id
    LEFT JOIN (
      SELECT id, task_id, state, created_at,
             ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at DESC) AS rn
      FROM runs
    ) lr ON lr.task_id = t.id AND lr.rn = 1
    LEFT JOIN (
      SELECT task_id,
             CAST(SUM(CASE WHEN state = 'Succeeded' THEN 1 ELSE 0 END) AS REAL)
               / COUNT(*) AS success_rate
      FROM (
        SELECT task_id, state,
               ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at DESC) AS rn
        FROM runs
      )
      WHERE rn <= 5
      GROUP BY task_id
    ) sr ON sr.task_id = t.id`;

  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(
        `SELECT COUNT(*) AS count FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         ${where}`,
      )
      .get(...params)?.count ?? 0;

  const { sort, order } = parseSortParams(
    { sort: input.sort, order: input.order },
    { allowed: TASK_SORT_ALLOWED, defaultSort: "name", defaultOrder: "asc" },
  );
  const orderBy =
    sort === "successRate"
      ? // Nulls (no runs) last in both directions — ops triage cares about tasks with history.
        `ORDER BY (sr.success_rate IS NULL) ASC, sr.success_rate ${
          order === "asc" ? "ASC" : "DESC"
        }, t.id ASC`
      : sqlOrderBy(
          sort,
          order,
          {
            name: "t.name COLLATE NOCASE",
            projectName: "IFNULL(p.name, '') COLLATE NOCASE",
            enabled: "t.enabled",
            createdAt: "t.created_at",
            lastRunAt: "lr.created_at",
          },
          "t.id ASC",
        );

  const rows = sqlite
    .query<SqlTaskRow, SQLQueryBindings[]>(
      `SELECT t.*, p.name AS project_name, a.name AS agent_profile_name,
              lr.id AS last_run_id, lr.state AS last_run_state, lr.created_at AS last_run_created_at
       ${from} ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset);

  const recentByTask = loadRecentRunsForTasks(
    db,
    rows.map((row) => row.id),
  );

  return {
    items: rows.map((row) => ({
      ...mapTask({ ...row, description: row.description ?? "" }),
      projectName: row.project_name,
      agentProfileName: row.agent_profile_name,
      lastRunId: row.last_run_id,
      lastRunState: row.last_run_state,
      lastRunCreatedAt: row.last_run_created_at,
      recentRuns: recentByTask.get(row.id) ?? [],
    })),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

function resolveTaskSource(project: Project, taskName: string): TaskSourceInfo {
  const repoPath = project.repoPath;
  const gojoYaml = join(repoPath, "gojo.yaml");
  const legacyYaml = join(repoPath, ".gojo", "project.yaml");
  const onDisk =
    (existsSync(gojoYaml) ? gojoYaml : null) ?? (existsSync(legacyYaml) ? legacyYaml : null);

  let promptFile: string | null = null;
  let inSyncedManifest = false;
  try {
    const parsed = JSON.parse(project.manifestJson) as {
      tasks?: Record<string, { promptFile?: unknown }>;
    };
    const entry = parsed.tasks?.[taskName];
    if (entry) {
      inSyncedManifest = true;
      if (typeof entry.promptFile === "string" && entry.promptFile.trim()) {
        promptFile = entry.promptFile.trim();
      }
    }
  } catch {
    // Stored manifest may be empty or non-JSON; treat as no source.
  }

  const manifestPath = onDisk ?? (inSyncedManifest ? gojoYaml : null);
  const promptAbsolutePath = promptFile ? join(repoPath, promptFile) : null;

  return {
    repoPath,
    manifestPath,
    promptFile,
    promptAbsolutePath,
  };
}

/** Single-task detail for ops inspect (enriched row + YAML/prompt paths). */
export function getTaskDetail(db: Database, taskId: string): TaskDetailRow | null {
  const repos = createRepositories(db);
  const task = repos.tasks.findById(taskId);
  if (!task) {
    return null;
  }

  const project = repos.projects.findById(task.projectId);
  const agent = task.agentProfileId ? repos.agentProfiles.findById(task.agentProfileId) : null;
  const recentRuns = loadRecentRunsForTasks(db, [task.id]).get(task.id) ?? [];
  const last = recentRuns.at(-1) ?? null;

  return {
    ...task,
    projectName: project?.name ?? null,
    agentProfileName: agent?.name ?? null,
    lastRunId: last?.id ?? null,
    lastRunState: last?.state ?? null,
    lastRunCreatedAt: last?.createdAt ?? null,
    recentRuns,
    source: project
      ? resolveTaskSource(project, task.name)
      : {
          repoPath: "",
          manifestPath: null,
          promptFile: null,
          promptAbsolutePath: null,
        },
  };
}

type RecentRunRow = {
  id: string;
  task_id: string;
  state: string;
  trigger: string;
  created_at: string;
  finished_at: string | null;
  rn: number;
};

/** Last 5 runs per task (oldest → newest), scoped to the given task ids. */
function loadRecentRunsForTasks(
  db: Database,
  taskIds: string[],
): Map<string, DashboardOverviewRun[]> {
  const byTask = new Map<string, DashboardOverviewRun[]>();
  if (taskIds.length === 0) {
    return byTask;
  }

  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = db
    .connection()
    .query<RecentRunRow, SQLQueryBindings[]>(
      `SELECT id, task_id, state, trigger, created_at, finished_at, rn
       FROM (
         SELECT id, task_id, state, trigger, created_at, finished_at,
                ROW_NUMBER() OVER (
                  PARTITION BY task_id ORDER BY created_at DESC
                ) AS rn
         FROM runs
         WHERE task_id IN (${placeholders})
       )
       WHERE rn <= 5
       ORDER BY task_id, rn DESC`,
    )
    .all(...taskIds);

  for (const row of rows) {
    const list = byTask.get(row.task_id) ?? [];
    list.push({
      id: row.id,
      state: row.state as RunState,
      trigger: row.trigger,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    });
    byTask.set(row.task_id, list);
  }

  return byTask;
}

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
  if (input.taskId) {
    buildWhere(clauses, params, "r.task_id = ?", input.taskId);
  }
  if (input.state) {
    buildWhere(clauses, params, "r.state = ?", input.state);
  }
  if (input.trigger) {
    buildWhere(clauses, params, "r.trigger = ?", input.trigger);
  }
  const q = input.q?.trim();
  if (q) {
    const pattern = likePattern(q);
    clauses.push(
      `(r.id LIKE ? ESCAPE '\\' OR r.project_id LIKE ? ESCAPE '\\' OR r.task_id LIKE ? ESCAPE '\\' OR IFNULL(p.name,'') LIKE ? ESCAPE '\\' OR IFNULL(t.name,'') LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const from = `FROM runs r
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN tasks t ON t.id = r.task_id`;

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
      taskName: "IFNULL(t.name, '') COLLATE NOCASE",
      projectName: "IFNULL(p.name, '') COLLATE NOCASE",
    },
    "r.id ASC",
  );

  const rows = sqlite
    .query<SqlRunRow, SQLQueryBindings[]>(
      `SELECT r.*, p.name AS project_name, t.name AS task_name
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
      taskName: row.task_name,
    })),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}

export function listSchedulesPage(
  db: Database,
  input: ListSchedulesPageInput,
): PaginatedList<ScheduleListRow> {
  const sqlite = db.connection();
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (input.projectId) {
    buildWhere(clauses, params, "t.project_id = ?", input.projectId);
  }
  if (input.taskId) {
    buildWhere(clauses, params, "s.task_id = ?", input.taskId);
  }
  if (input.enabled === true) {
    buildWhere(clauses, params, "s.enabled = ?", 1);
  } else if (input.enabled === false) {
    buildWhere(clauses, params, "s.enabled = ?", 0);
  }
  const q = input.q?.trim();
  if (q) {
    const pattern = likePattern(q);
    clauses.push(
      `(s.name LIKE ? ESCAPE '\\' OR s.id LIKE ? ESCAPE '\\' OR IFNULL(t.name,'') LIKE ? ESCAPE '\\' OR IFNULL(p.name,'') LIKE ? ESCAPE '\\' OR s.cron_expr LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const from = `FROM schedules s
    LEFT JOIN tasks t ON t.id = s.task_id
    LEFT JOIN projects p ON p.id = t.project_id`;

  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(`SELECT COUNT(*) AS count ${from} ${where}`)
      .get(...params)?.count ?? 0;

  const { sort, order } = parseSortParams(
    { sort: input.sort, order: input.order },
    { allowed: SCHEDULE_SORT_ALLOWED, defaultSort: "createdAt", defaultOrder: "asc" },
  );
  const orderBy = sqlOrderBy(
    sort,
    order,
    {
      name: "s.name COLLATE NOCASE",
      projectName: "IFNULL(p.name, '') COLLATE NOCASE",
      cronExpr: "s.cron_expr",
      nextRunAt: "s.next_run_at",
      lastRunAt: "s.last_run_at",
      enabled: "s.enabled",
      createdAt: "s.created_at",
    },
    "s.id ASC",
  );

  const rows = sqlite
    .query<SqlScheduleRow, SQLQueryBindings[]>(
      `SELECT s.*, t.name AS task_name, t.project_id AS project_id, p.name AS project_name
       ${from} ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset);

  return {
    items: rows.map((row) => {
      const schedule = mapSchedule(row);
      return {
        ...schedule,
        taskName: row.task_name,
        projectId: row.project_id,
        projectName: row.project_name,
        cronDescription: describeCron(schedule.cronExpr),
      };
    }),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}
