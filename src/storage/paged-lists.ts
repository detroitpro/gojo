import type { SQLQueryBindings } from "bun:sqlite";

import type { PageParams, PaginatedList } from "@shared/pagination";
import type { RunState } from "@shared/run-states";

import { describeCron } from "@/scheduler/describe-cron";
import type { Database } from "@/storage";
import type { Project, Run, RunTrigger, Schedule, Task } from "@/storage/types";
import { mapProject, mapRun, mapSchedule, mapTask } from "@/storage/repositories";

export type ListProjectsPageInput = PageParams & {
  q?: string | null;
};

export type ListTasksPageInput = PageParams & {
  projectId?: string | null;
  enabled?: boolean | null;
  q?: string | null;
};

export type ListRunsPageInput = PageParams & {
  projectId?: string | null;
  taskId?: string | null;
  state?: string | null;
  trigger?: string | null;
  q?: string | null;
};

export type ListSchedulesPageInput = PageParams & {
  projectId?: string | null;
  enabled?: boolean | null;
  q?: string | null;
};

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
};

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
            WHERE t.project_id = p.id AND s.enabled = 1) AS enabled_schedule_count
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
  };

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
            WHERE t.project_id = p.id AND s.enabled = 1) AS enabled_schedule_count
       FROM projects p
       ${where}
       ORDER BY p.created_at
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
      };
    }),
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
    ) lr ON lr.task_id = t.id AND lr.rn = 1`;

  const total =
    sqlite
      .query<{ count: number }, SQLQueryBindings[]>(
        `SELECT COUNT(*) AS count FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         ${where}`,
      )
      .get(...params)?.count ?? 0;

  const rows = sqlite
    .query<SqlTaskRow, SQLQueryBindings[]>(
      `SELECT t.*, p.name AS project_name, a.name AS agent_profile_name,
              lr.id AS last_run_id, lr.state AS last_run_state, lr.created_at AS last_run_created_at
       ${from} ${where}
       ORDER BY t.name ASC, t.project_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset);

  return {
    items: rows.map((row) => ({
      ...mapTask({ ...row, description: row.description ?? "" }),
      projectName: row.project_name,
      agentProfileName: row.agent_profile_name,
      lastRunId: row.last_run_id,
      lastRunState: row.last_run_state,
      lastRunCreatedAt: row.last_run_created_at,
    })),
    total,
    limit: input.limit,
    offset: input.offset,
  };
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

  const rows = sqlite
    .query<SqlRunRow, SQLQueryBindings[]>(
      `SELECT r.*, p.name AS project_name, t.name AS task_name
       ${from} ${where}
       ORDER BY r.created_at DESC
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

  const rows = sqlite
    .query<SqlScheduleRow, SQLQueryBindings[]>(
      `SELECT s.*, t.name AS task_name, t.project_id AS project_id, p.name AS project_name
       ${from} ${where}
       ORDER BY s.created_at
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
