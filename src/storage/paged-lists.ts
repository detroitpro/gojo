import type { PageParams, PaginatedList } from "@shared/pagination";

import type { Database } from "@/storage";
import type { Project, Run, Schedule, Task } from "@/storage/types";
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
};

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
  params: unknown[],
  clause: string,
  value: unknown,
): void {
  clauses.push(clause);
  params.push(value);
}

export function listProjectsPage(
  db: Database,
  input: ListProjectsPageInput,
): PaginatedList<Project> {
  const sqlite = db.connection();
  const clauses: string[] = [];
  const params: unknown[] = [];
  const q = input.q?.trim();
  if (q) {
    buildWhere(
      clauses,
      params,
      `(name LIKE ? ESCAPE '\\' OR repo_path LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')`,
      likePattern(q),
    );
    params.push(likePattern(q), likePattern(q));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total =
    sqlite
      .query<{ count: number }, unknown[]>(
        `SELECT COUNT(*) AS count FROM projects ${where}`,
      )
      .get(...params)?.count ?? 0;

  const rows = sqlite
    .query(
      `SELECT * FROM projects ${where} ORDER BY created_at LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset) as Parameters<typeof mapProject>[0][];

  return {
    items: rows.map(mapProject),
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
  const params: unknown[] = [];

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
      .query<{ count: number }, unknown[]>(
        `SELECT COUNT(*) AS count FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         ${where}`,
      )
      .get(...params)?.count ?? 0;

  const rows = sqlite
    .query<SqlTaskRow, unknown[]>(
      `SELECT t.*, p.name AS project_name, a.name AS agent_profile_name,
              lr.id AS last_run_id, lr.state AS last_run_state, lr.created_at AS last_run_created_at
       ${from} ${where}
       ORDER BY t.name ASC, t.project_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset);

  return {
    items: rows.map((row) => ({
      ...mapTask(row),
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
  const params: unknown[] = [];

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
      .query<{ count: number }, unknown[]>(`SELECT COUNT(*) AS count ${from} ${where}`)
      .get(...params)?.count ?? 0;

  const rows = sqlite
    .query<SqlRunRow, unknown[]>(
      `SELECT r.*, p.name AS project_name, t.name AS task_name
       ${from} ${where}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset);

  return {
    items: rows.map((row) => ({
      ...mapRun(row),
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
  const params: unknown[] = [];

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
      .query<{ count: number }, unknown[]>(`SELECT COUNT(*) AS count ${from} ${where}`)
      .get(...params)?.count ?? 0;

  const rows = sqlite
    .query<SqlScheduleRow, unknown[]>(
      `SELECT s.*, t.name AS task_name, t.project_id AS project_id, p.name AS project_name
       ${from} ${where}
       ORDER BY s.created_at
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset);

  return {
    items: rows.map((row) => ({
      ...mapSchedule(row),
      taskName: row.task_name,
      projectId: row.project_id,
      projectName: row.project_name,
    })),
    total,
    limit: input.limit,
    offset: input.offset,
  };
}
