import { ulid } from "ulid";

import { RunState } from "@shared/run-states";

import type { Database } from "./db";
import type {
  Attempt,
  AuditEvent,
  AgentProfile,
  CreateAgentProfileInput,
  CreateAttemptInput,
  CreateAuditEventInput,
  CreateProjectInput,
  SecretRecord,
  UpsertSecretInput,
  CreateRunInput,
  CreateScheduleInput,
  CreateTaskInput,
  Project,
  Run,
  Schedule,
  Task,
  UpdateAttemptInput,
  UpdateProjectInput,
  UpdateRunInput,
  UpdateScheduleInput,
  UpdateTaskInput,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function boolFromInt(value: number): boolean {
  return value !== 0;
}

function intFromBool(value: boolean): number {
  return value ? 1 : 0;
}

interface ProjectRow {
  id: string;
  name: string;
  repo_path: string;
  remote_url: string | null;
  default_branch: string;
  manifest_json: string;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  agent_profile_id: string | null;
  prompt: string;
  validation_profile_json: string;
  integration_json: string;
  failure_policy_json: string;
  concurrency_json: string;
  enabled: number;
  created_at: string;
}

interface ScheduleRow {
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
}

interface RunRow {
  id: string;
  project_id: string;
  task_id: string;
  schedule_id: string | null;
  state: Run["state"];
  idempotency_key: string;
  trigger: Run["trigger"];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

interface AttemptRow {
  id: string;
  run_id: string;
  attempt_number: number;
  state: Attempt["state"];
  workspace_path: string | null;
  branch_name: string | null;
  starting_commit: string | null;
  result_commit: string | null;
  agent_version: string | null;
  exit_code: number | null;
  handoff_json: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface AuditEventRow {
  id: string;
  actor: string;
  action: string;
  target: string;
  previous_json: string | null;
  new_json: string | null;
  source_ip: string | null;
  auth_method: string | null;
  correlation_id: string | null;
  success: number;
  created_at: string;
}

interface SecretRow {
  id: string;
  name: string;
  project_id: string | null;
  ciphertext: string;
  created_at: string;
  updated_at: string;
}

interface AgentProfileRow {
  id: string;
  project_id: string | null;
  name: string;
  adapter: string;
  config_json: string;
  created_at: string;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repo_path,
    remoteUrl: row.remote_url,
    defaultBranch: row.default_branch,
    manifestJson: row.manifest_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    agentProfileId: row.agent_profile_id,
    prompt: row.prompt,
    validationProfileJson: row.validation_profile_json,
    integrationJson: row.integration_json,
    failurePolicyJson: row.failure_policy_json,
    concurrencyJson: row.concurrency_json,
    enabled: boolFromInt(row.enabled),
    createdAt: row.created_at,
  };
}

function mapSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    taskId: row.task_id,
    name: row.name,
    cronExpr: row.cron_expr,
    timezone: row.timezone,
    enabled: boolFromInt(row.enabled),
    overlapPolicy: row.overlap_policy,
    missedRunPolicy: row.missed_run_policy,
    retryJson: row.retry_json,
    consecutiveFailures: row.consecutive_failures,
    disableAfter: row.disable_after,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
  };
}

function mapRun(row: RunRow): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    scheduleId: row.schedule_id,
    state: row.state,
    idempotencyKey: row.idempotency_key,
    trigger: row.trigger,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  };
}

function mapAttempt(row: AttemptRow): Attempt {
  return {
    id: row.id,
    runId: row.run_id,
    attemptNumber: row.attempt_number,
    state: row.state,
    workspacePath: row.workspace_path,
    branchName: row.branch_name,
    startingCommit: row.starting_commit,
    resultCommit: row.result_commit,
    agentVersion: row.agent_version,
    exitCode: row.exit_code,
    handoffJson: row.handoff_json,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    target: row.target,
    previousJson: row.previous_json,
    newJson: row.new_json,
    sourceIp: row.source_ip,
    authMethod: row.auth_method,
    correlationId: row.correlation_id,
    success: boolFromInt(row.success),
    createdAt: row.created_at,
  };
}

function mapSecret(row: SecretRow): SecretRecord {
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    ciphertext: row.ciphertext,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentProfile(row: AgentProfileRow): AgentProfile {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    adapter: row.adapter,
    configJson: row.config_json,
    createdAt: row.created_at,
  };
}

export interface ProjectRepository {
  create(input: CreateProjectInput): Project;
  findById(id: string): Project | null;
  list(): Project[];
  update(id: string, input: UpdateProjectInput): Project | null;
  delete(id: string): boolean;
}

export interface TaskRepository {
  create(input: CreateTaskInput): Task;
  findById(id: string): Task | null;
  listByProject(projectId: string): Task[];
  update(id: string, input: UpdateTaskInput): Task | null;
  delete(id: string): boolean;
}

export interface ScheduleRepository {
  create(input: CreateScheduleInput): Schedule;
  findById(id: string): Schedule | null;
  listByTask(taskId: string): Schedule[];
  listDue(nowIso: string): Schedule[];
  update(id: string, input: UpdateScheduleInput): Schedule | null;
  updateNextRun(
    id: string,
    nextRunAt: string | null,
    lastRunAt?: string | null,
  ): Schedule | null;
  incrementFailures(id: string): number;
  resetFailures(id: string): void;
  disable(id: string): boolean;
  delete(id: string): boolean;
}

export interface RunRepository {
  create(input: CreateRunInput): Run;
  findById(id: string): Run | null;
  findByIdempotencyKey(key: string): Run | null;
  listByProject(projectId: string): Run[];
  listNonTerminal(): Run[];
  update(id: string, input: UpdateRunInput): Run | null;
  delete(id: string): boolean;
}

export interface AgentProfileRepository {
  create(input: CreateAgentProfileInput): AgentProfile;
  findById(id: string): AgentProfile | null;
}

export interface AttemptRepository {
  create(input: CreateAttemptInput): Attempt;
  findById(id: string): Attempt | null;
  listByRun(runId: string): Attempt[];
  update(id: string, input: UpdateAttemptInput): Attempt | null;
  delete(id: string): boolean;
}

export interface AuditRepository {
  create(input: CreateAuditEventInput): AuditEvent;
  findById(id: string): AuditEvent | null;
  listByTarget(target: string, limit?: number): AuditEvent[];
}

export interface SecretRepository {
  upsert(input: UpsertSecretInput): SecretRecord;
  findByName(name: string, projectId?: string | null): SecretRecord | null;
  deleteByName(name: string, projectId?: string | null): boolean;
  list(): SecretRecord[];
}

export interface Repositories {
  projects: ProjectRepository;
  tasks: TaskRepository;
  schedules: ScheduleRepository;
  runs: RunRepository;
  attempts: AttemptRepository;
  audit: AuditRepository;
  secrets: SecretRepository;
  agentProfiles: AgentProfileRepository;
}

export function createRepositories(db: Database): Repositories {
  const sqlite = db.connection();

  const projects: ProjectRepository = {
    create(input) {
      const id = ulid();
      const createdAt = nowIso();
      const defaultBranch = input.defaultBranch ?? "main";
      const manifestJson = input.manifestJson ?? "{}";

      sqlite
        .query(
          `INSERT INTO projects (
            id, name, repo_path, remote_url, default_branch, manifest_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.repoPath,
          input.remoteUrl ?? null,
          defaultBranch,
          manifestJson,
          createdAt,
          createdAt,
        );

      return mapProject({
        id,
        name: input.name,
        repo_path: input.repoPath,
        remote_url: input.remoteUrl ?? null,
        default_branch: defaultBranch,
        manifest_json: manifestJson,
        created_at: createdAt,
        updated_at: createdAt,
      });
    },

    findById(id) {
      const row = sqlite
        .query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?")
        .get(id);
      return row ? mapProject(row) : null;
    },

    list() {
      const rows = sqlite.query<ProjectRow, []>("SELECT * FROM projects ORDER BY created_at").all();
      return rows.map(mapProject);
    },

    update(id, input) {
      const existing = this.findById(id);
      if (!existing) {
        return null;
      }

      const updatedAt = nowIso();
      const next: Project = {
        ...existing,
        name: input.name ?? existing.name,
        repoPath: input.repoPath ?? existing.repoPath,
        remoteUrl: input.remoteUrl !== undefined ? input.remoteUrl : existing.remoteUrl,
        defaultBranch: input.defaultBranch ?? existing.defaultBranch,
        manifestJson: input.manifestJson ?? existing.manifestJson,
        updatedAt,
      };

      sqlite
        .query(
          `UPDATE projects SET
            name = ?, repo_path = ?, remote_url = ?, default_branch = ?,
            manifest_json = ?, updated_at = ?
          WHERE id = ?`,
        )
        .run(
          next.name,
          next.repoPath,
          next.remoteUrl,
          next.defaultBranch,
          next.manifestJson,
          next.updatedAt,
          id,
        );

      return next;
    },

    delete(id) {
      const result = sqlite.query("DELETE FROM projects WHERE id = ?").run(id);
      return result.changes > 0;
    },
  };

  const tasks: TaskRepository = {
    create(input) {
      const id = ulid();
      const createdAt = nowIso();

      sqlite
        .query(
          `INSERT INTO tasks (
            id, project_id, name, description, agent_profile_id, prompt,
            validation_profile_json, integration_json, failure_policy_json,
            concurrency_json, enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.name,
          input.description ?? "",
          input.agentProfileId ?? null,
          input.prompt,
          input.validationProfileJson ?? "{}",
          input.integrationJson ?? "{}",
          input.failurePolicyJson ?? "{}",
          input.concurrencyJson ?? "{}",
          intFromBool(input.enabled ?? true),
          createdAt,
        );

      return mapTask({
        id,
        project_id: input.projectId,
        name: input.name,
        description: input.description ?? "",
        agent_profile_id: input.agentProfileId ?? null,
        prompt: input.prompt,
        validation_profile_json: input.validationProfileJson ?? "{}",
        integration_json: input.integrationJson ?? "{}",
        failure_policy_json: input.failurePolicyJson ?? "{}",
        concurrency_json: input.concurrencyJson ?? "{}",
        enabled: intFromBool(input.enabled ?? true),
        created_at: createdAt,
      });
    },

    findById(id) {
      const row = sqlite.query<TaskRow, [string]>("SELECT * FROM tasks WHERE id = ?").get(id);
      return row ? mapTask(row) : null;
    },

    listByProject(projectId) {
      const rows = sqlite
        .query<TaskRow, [string]>("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at")
        .all(projectId);
      return rows.map(mapTask);
    },

    update(id, input) {
      const existing = this.findById(id);
      if (!existing) {
        return null;
      }

      const next: Task = {
        ...existing,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        agentProfileId:
          input.agentProfileId !== undefined ? input.agentProfileId : existing.agentProfileId,
        prompt: input.prompt ?? existing.prompt,
        validationProfileJson: input.validationProfileJson ?? existing.validationProfileJson,
        integrationJson: input.integrationJson ?? existing.integrationJson,
        failurePolicyJson: input.failurePolicyJson ?? existing.failurePolicyJson,
        concurrencyJson: input.concurrencyJson ?? existing.concurrencyJson,
        enabled: input.enabled ?? existing.enabled,
      };

      sqlite
        .query(
          `UPDATE tasks SET
            name = ?, description = ?, agent_profile_id = ?, prompt = ?,
            validation_profile_json = ?, integration_json = ?, failure_policy_json = ?,
            concurrency_json = ?, enabled = ?
          WHERE id = ?`,
        )
        .run(
          next.name,
          next.description,
          next.agentProfileId,
          next.prompt,
          next.validationProfileJson,
          next.integrationJson,
          next.failurePolicyJson,
          next.concurrencyJson,
          intFromBool(next.enabled),
          id,
        );

      return next;
    },

    delete(id) {
      const result = sqlite.query("DELETE FROM tasks WHERE id = ?").run(id);
      return result.changes > 0;
    },
  };

  const schedules: ScheduleRepository = {
    create(input) {
      const id = ulid();
      const createdAt = nowIso();

      sqlite
        .query(
          `INSERT INTO schedules (
            id, task_id, name, cron_expr, timezone, enabled, overlap_policy,
            missed_run_policy, retry_json, consecutive_failures, disable_after,
            next_run_at, last_run_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)`,
        )
        .run(
          id,
          input.taskId,
          input.name,
          input.cronExpr,
          input.timezone ?? "UTC",
          intFromBool(input.enabled ?? true),
          input.overlapPolicy ?? "skip",
          input.missedRunPolicy ?? "skip",
          input.retryJson ?? "{}",
          input.disableAfter ?? null,
          input.nextRunAt ?? null,
          createdAt,
        );

      return mapSchedule({
        id,
        task_id: input.taskId,
        name: input.name,
        cron_expr: input.cronExpr,
        timezone: input.timezone ?? "UTC",
        enabled: intFromBool(input.enabled ?? true),
        overlap_policy: input.overlapPolicy ?? "skip",
        missed_run_policy: input.missedRunPolicy ?? "skip",
        retry_json: input.retryJson ?? "{}",
        consecutive_failures: 0,
        disable_after: input.disableAfter ?? null,
        next_run_at: input.nextRunAt ?? null,
        last_run_at: null,
        created_at: createdAt,
      });
    },

    findById(id) {
      const row = sqlite.query<ScheduleRow, [string]>("SELECT * FROM schedules WHERE id = ?").get(id);
      return row ? mapSchedule(row) : null;
    },

    listByTask(taskId) {
      const rows = sqlite
        .query<ScheduleRow, [string]>("SELECT * FROM schedules WHERE task_id = ? ORDER BY created_at")
        .all(taskId);
      return rows.map(mapSchedule);
    },

    listDue(nowIso) {
      const rows = sqlite
        .query<ScheduleRow, [string]>(
          `SELECT * FROM schedules
           WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
           ORDER BY next_run_at`,
        )
        .all(nowIso);
      return rows.map(mapSchedule);
    },

    update(id, input) {
      const existing = this.findById(id);
      if (!existing) {
        return null;
      }

      const next: Schedule = {
        ...existing,
        name: input.name ?? existing.name,
        cronExpr: input.cronExpr ?? existing.cronExpr,
        timezone: input.timezone ?? existing.timezone,
        enabled: input.enabled ?? existing.enabled,
        overlapPolicy: input.overlapPolicy ?? existing.overlapPolicy,
        missedRunPolicy: input.missedRunPolicy ?? existing.missedRunPolicy,
        retryJson: input.retryJson ?? existing.retryJson,
        consecutiveFailures: input.consecutiveFailures ?? existing.consecutiveFailures,
        disableAfter: input.disableAfter !== undefined ? input.disableAfter : existing.disableAfter,
        nextRunAt: input.nextRunAt !== undefined ? input.nextRunAt : existing.nextRunAt,
        lastRunAt: input.lastRunAt !== undefined ? input.lastRunAt : existing.lastRunAt,
      };

      sqlite
        .query(
          `UPDATE schedules SET
            name = ?, cron_expr = ?, timezone = ?, enabled = ?, overlap_policy = ?,
            missed_run_policy = ?, retry_json = ?, consecutive_failures = ?,
            disable_after = ?, next_run_at = ?, last_run_at = ?
          WHERE id = ?`,
        )
        .run(
          next.name,
          next.cronExpr,
          next.timezone,
          intFromBool(next.enabled),
          next.overlapPolicy,
          next.missedRunPolicy,
          next.retryJson,
          next.consecutiveFailures,
          next.disableAfter,
          next.nextRunAt,
          next.lastRunAt,
          id,
        );

      return next;
    },

    updateNextRun(id, nextRunAt, lastRunAt) {
      const existing = this.findById(id);
      if (!existing) {
        return null;
      }

      const nextLastRunAt = lastRunAt !== undefined ? lastRunAt : existing.lastRunAt;
      sqlite
        .query("UPDATE schedules SET next_run_at = ?, last_run_at = ? WHERE id = ?")
        .run(nextRunAt, nextLastRunAt, id);

      return {
        ...existing,
        nextRunAt,
        lastRunAt: nextLastRunAt,
      };
    },

    incrementFailures(id) {
      sqlite.query("UPDATE schedules SET consecutive_failures = consecutive_failures + 1 WHERE id = ?").run(id);
      const row = sqlite
        .query<{ consecutive_failures: number }, [string]>(
          "SELECT consecutive_failures FROM schedules WHERE id = ?",
        )
        .get(id);
      return row?.consecutive_failures ?? 0;
    },

    resetFailures(id) {
      sqlite.query("UPDATE schedules SET consecutive_failures = 0 WHERE id = ?").run(id);
    },

    disable(id) {
      const result = sqlite
        .query("UPDATE schedules SET enabled = 0 WHERE id = ?")
        .run(id);
      return result.changes > 0;
    },

    delete(id) {
      const result = sqlite.query("DELETE FROM schedules WHERE id = ?").run(id);
      return result.changes > 0;
    },
  };

  const runs: RunRepository = {
    create(input) {
      const id = ulid();
      const createdAt = nowIso();
      const state = input.state ?? RunState.Scheduled;

      sqlite
        .query(
          `INSERT INTO runs (
            id, project_id, task_id, schedule_id, state, idempotency_key,
            trigger, created_at, started_at, finished_at, error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
        )
        .run(
          id,
          input.projectId,
          input.taskId,
          input.scheduleId ?? null,
          state,
          input.idempotencyKey,
          input.trigger,
          createdAt,
        );

      return mapRun({
        id,
        project_id: input.projectId,
        task_id: input.taskId,
        schedule_id: input.scheduleId ?? null,
        state,
        idempotency_key: input.idempotencyKey,
        trigger: input.trigger,
        created_at: createdAt,
        started_at: null,
        finished_at: null,
        error_message: null,
      });
    },

    findById(id) {
      const row = sqlite.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
      return row ? mapRun(row) : null;
    },

    findByIdempotencyKey(key) {
      const row = sqlite
        .query<RunRow, [string]>("SELECT * FROM runs WHERE idempotency_key = ?")
        .get(key);
      return row ? mapRun(row) : null;
    },

    listByProject(projectId) {
      const rows = sqlite
        .query<RunRow, [string]>("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC")
        .all(projectId);
      return rows.map(mapRun);
    },

    listNonTerminal() {
      const rows = sqlite
        .query<RunRow, []>(
          `SELECT * FROM runs
           WHERE state NOT IN (
             'Succeeded', 'Failed', 'Canceled', 'TimedOut', 'Skipped',
             'Superseded', 'Abandoned', 'Blocked', 'Conflict', 'InfrastructureFailure'
           )
           ORDER BY created_at`,
        )
        .all();
      return rows.map(mapRun);
    },

    update(id, input) {
      const existing = this.findById(id);
      if (!existing) {
        return null;
      }

      const next: Run = {
        ...existing,
        state: input.state ?? existing.state,
        startedAt: input.startedAt !== undefined ? input.startedAt : existing.startedAt,
        finishedAt: input.finishedAt !== undefined ? input.finishedAt : existing.finishedAt,
        errorMessage:
          input.errorMessage !== undefined ? input.errorMessage : existing.errorMessage,
      };

      sqlite
        .query(
          `UPDATE runs SET state = ?, started_at = ?, finished_at = ?, error_message = ? WHERE id = ?`,
        )
        .run(next.state, next.startedAt, next.finishedAt, next.errorMessage, id);

      return next;
    },

    delete(id) {
      const result = sqlite.query("DELETE FROM runs WHERE id = ?").run(id);
      return result.changes > 0;
    },
  };

  const attempts: AttemptRepository = {
    create(input) {
      const id = ulid();
      const state = input.state ?? "pending";

      sqlite
        .query(
          `INSERT INTO attempts (
            id, run_id, attempt_number, state, workspace_path, branch_name,
            starting_commit, result_commit, agent_version, exit_code,
            handoff_json, started_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)`,
        )
        .run(
          id,
          input.runId,
          input.attemptNumber,
          state,
          input.workspacePath ?? null,
          input.branchName ?? null,
          input.startingCommit ?? null,
        );

      return mapAttempt({
        id,
        run_id: input.runId,
        attempt_number: input.attemptNumber,
        state,
        workspace_path: input.workspacePath ?? null,
        branch_name: input.branchName ?? null,
        starting_commit: input.startingCommit ?? null,
        result_commit: null,
        agent_version: null,
        exit_code: null,
        handoff_json: null,
        started_at: null,
        finished_at: null,
      });
    },

    findById(id) {
      const row = sqlite.query<AttemptRow, [string]>("SELECT * FROM attempts WHERE id = ?").get(id);
      return row ? mapAttempt(row) : null;
    },

    listByRun(runId) {
      const rows = sqlite
        .query<AttemptRow, [string]>(
          "SELECT * FROM attempts WHERE run_id = ? ORDER BY attempt_number",
        )
        .all(runId);
      return rows.map(mapAttempt);
    },

    update(id, input) {
      const existing = this.findById(id);
      if (!existing) {
        return null;
      }

      const next: Attempt = {
        ...existing,
        state: input.state ?? existing.state,
        workspacePath:
          input.workspacePath !== undefined ? input.workspacePath : existing.workspacePath,
        branchName: input.branchName !== undefined ? input.branchName : existing.branchName,
        startingCommit:
          input.startingCommit !== undefined ? input.startingCommit : existing.startingCommit,
        resultCommit:
          input.resultCommit !== undefined ? input.resultCommit : existing.resultCommit,
        agentVersion:
          input.agentVersion !== undefined ? input.agentVersion : existing.agentVersion,
        exitCode: input.exitCode !== undefined ? input.exitCode : existing.exitCode,
        handoffJson: input.handoffJson !== undefined ? input.handoffJson : existing.handoffJson,
        startedAt: input.startedAt !== undefined ? input.startedAt : existing.startedAt,
        finishedAt: input.finishedAt !== undefined ? input.finishedAt : existing.finishedAt,
      };

      sqlite
        .query(
          `UPDATE attempts SET
            state = ?, workspace_path = ?, branch_name = ?, starting_commit = ?,
            result_commit = ?, agent_version = ?, exit_code = ?, handoff_json = ?,
            started_at = ?, finished_at = ?
          WHERE id = ?`,
        )
        .run(
          next.state,
          next.workspacePath,
          next.branchName,
          next.startingCommit,
          next.resultCommit,
          next.agentVersion,
          next.exitCode,
          next.handoffJson,
          next.startedAt,
          next.finishedAt,
          id,
        );

      return next;
    },

    delete(id) {
      const result = sqlite.query("DELETE FROM attempts WHERE id = ?").run(id);
      return result.changes > 0;
    },
  };

  const audit: AuditRepository = {
    create(input) {
      const id = ulid();
      const createdAt = nowIso();
      const success = input.success ?? true;

      sqlite
        .query(
          `INSERT INTO audit_events (
            id, actor, action, target, previous_json, new_json, source_ip,
            auth_method, correlation_id, success, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.actor,
          input.action,
          input.target,
          input.previousJson ?? null,
          input.newJson ?? null,
          input.sourceIp ?? null,
          input.authMethod ?? null,
          input.correlationId ?? null,
          intFromBool(success),
          createdAt,
        );

      return mapAuditEvent({
        id,
        actor: input.actor,
        action: input.action,
        target: input.target,
        previous_json: input.previousJson ?? null,
        new_json: input.newJson ?? null,
        source_ip: input.sourceIp ?? null,
        auth_method: input.authMethod ?? null,
        correlation_id: input.correlationId ?? null,
        success: intFromBool(success),
        created_at: createdAt,
      });
    },

    findById(id) {
      const row = sqlite
        .query<AuditEventRow, [string]>("SELECT * FROM audit_events WHERE id = ?")
        .get(id);
      return row ? mapAuditEvent(row) : null;
    },

    listByTarget(target, limit = 100) {
      const rows = sqlite
        .query<AuditEventRow, [string, number]>(
          "SELECT * FROM audit_events WHERE target = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(target, limit);
      return rows.map(mapAuditEvent);
    },
  };

  const secrets: SecretRepository = {
    upsert(input) {
      const existing = this.findByName(input.name, input.projectId ?? null);
      const now = nowIso();

      if (existing) {
        sqlite
          .query("UPDATE secrets SET ciphertext = ?, updated_at = ? WHERE id = ?")
          .run(input.ciphertext, now, existing.id);
        return mapSecret({
          id: existing.id,
          name: input.name,
          project_id: input.projectId ?? null,
          ciphertext: input.ciphertext,
          created_at: existing.createdAt,
          updated_at: now,
        });
      }

      const id = ulid();
      sqlite
        .query(
          `INSERT INTO secrets (id, name, project_id, ciphertext, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.name, input.projectId ?? null, input.ciphertext, now, now);

      return mapSecret({
        id,
        name: input.name,
        project_id: input.projectId ?? null,
        ciphertext: input.ciphertext,
        created_at: now,
        updated_at: now,
      });
    },

    findByName(name, projectId = null) {
      const row =
        projectId === null || projectId === undefined
          ? sqlite
              .query<SecretRow, [string]>(
                "SELECT * FROM secrets WHERE name = ? AND project_id IS NULL",
              )
              .get(name)
          : sqlite
              .query<SecretRow, [string, string]>(
                "SELECT * FROM secrets WHERE name = ? AND project_id = ?",
              )
              .get(name, projectId);
      return row ? mapSecret(row) : null;
    },

    deleteByName(name, projectId = null) {
      const result =
        projectId === null || projectId === undefined
          ? sqlite
              .query("DELETE FROM secrets WHERE name = ? AND project_id IS NULL")
              .run(name)
          : sqlite
              .query("DELETE FROM secrets WHERE name = ? AND project_id = ?")
              .run(name, projectId);
      return result.changes > 0;
    },

    list() {
      const rows = sqlite
        .query<SecretRow, []>("SELECT * FROM secrets ORDER BY name, project_id")
        .all();
      return rows.map(mapSecret);
    },
  };

  const agentProfiles: AgentProfileRepository = {
    create(input) {
      const id = ulid();
      const createdAt = nowIso();
      const configJson = input.configJson ?? "{}";

      sqlite
        .query(
          `INSERT INTO agent_profiles (id, project_id, name, adapter, config_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.projectId ?? null, input.name, input.adapter, configJson, createdAt);

      return mapAgentProfile({
        id,
        project_id: input.projectId ?? null,
        name: input.name,
        adapter: input.adapter,
        config_json: configJson,
        created_at: createdAt,
      });
    },

    findById(id) {
      const row = sqlite
        .query<AgentProfileRow, [string]>("SELECT * FROM agent_profiles WHERE id = ?")
        .get(id);
      return row ? mapAgentProfile(row) : null;
    },
  };

  return {
    projects,
    tasks,
    schedules,
    runs,
    attempts,
    audit,
    secrets,
    agentProfiles,
  };
}
