import { ulid } from "ulid";

import { RunState } from "@shared/run-states";

import type { Database } from "./db";
import type {
  Agent,
  Attempt,
  AuditEvent,
  Profile,
  CreateAgentInput,
  CreateAttemptInput,
  CreateAuditEventInput,
  CreateProfileInput,
  CreateProjectInput,
  CreateRunInput,
  CreateScheduleInput,
  Project,
  Run,
  RunImpactItem,
  RunImpactItemDraft,
  RunIntegration,
  Schedule,
  SecretRecord,
  UpdateAgentInput,
  UpdateAttemptInput,
  UpdateProjectInput,
  UpdateRunInput,
  UpdateRunIntegrationInput,
  UpdateScheduleInput,
  UpsertRunIntegrationInput,
  UpsertSecretInput,
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

interface AgentRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  profile_id: string | null;
  prompt: string;
  validation_profile_json: string;
  integration_json: string;
  failure_policy_json: string;
  concurrency_json: string;
  notifications_json: string;
  environment_json: string;
  trigger_json: string;
  enabled: number;
  created_at: string;
}

interface ScheduleRow {
  id: string;
  agent_id: string;
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
  agent_id: string;
  schedule_id: string | null;
  state: Run["state"];
  idempotency_key: string;
  trigger: Run["trigger"];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  not_before_at: string | null;
  expires_at: string | null;
  admitted_at: string | null;
  priority: number;
  work_item_id: string | null;
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
  pr_url: string | null;
  agent_version: string | null;
  agent_adapter: string | null;
  exit_code: number | null;
  handoff_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  total_cost_usd: number | null;
  cost_source: string | null;
  usage_json: string | null;
  model: string | null;
  agent_duration_ms: number | null;
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

interface ProfileRow {
  id: string;
  project_id: string | null;
  name: string;
  adapter: string;
  config_json: string;
  created_at: string;
}

export function mapProject(row: ProjectRow): Project {
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

export function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    profileId: row.profile_id,
    prompt: row.prompt,
    validationProfileJson: row.validation_profile_json,
    integrationJson: row.integration_json,
    failurePolicyJson: row.failure_policy_json,
    concurrencyJson: row.concurrency_json,
    notificationsJson: row.notifications_json,
    environmentJson: row.environment_json ?? "{}",
    triggerJson: row.trigger_json ?? "{}",
    enabled: boolFromInt(row.enabled),
    createdAt: row.created_at,
  };
}

export function mapSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    agentId: row.agent_id,
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

export function mapRun(row: RunRow): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    agentId: row.agent_id,
    scheduleId: row.schedule_id,
    state: row.state,
    idempotencyKey: row.idempotency_key,
    trigger: row.trigger,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    notBeforeAt: row.not_before_at ?? null,
    expiresAt: row.expires_at ?? null,
    admittedAt: row.admitted_at ?? null,
    priority: row.priority ?? 30,
    workItemId: row.work_item_id ?? null,
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
    prUrl: row.pr_url ?? null,
    agentVersion: row.agent_version,
    agentAdapter: row.agent_adapter ?? null,
    exitCode: row.exit_code,
    handoffJson: row.handoff_json,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    inputTokens: row.input_tokens ?? null,
    outputTokens: row.output_tokens ?? null,
    cacheReadTokens: row.cache_read_tokens ?? null,
    cacheWriteTokens: row.cache_write_tokens ?? null,
    totalCostUsd: row.total_cost_usd ?? null,
    costSource: row.cost_source ?? null,
    usageJson: row.usage_json ?? null,
    model: row.model ?? null,
    agentDurationMs: row.agent_duration_ms ?? null,
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

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    adapter: row.adapter,
    configJson: row.config_json,
    createdAt: row.created_at,
  };
}

interface RunImpactItemRow {
  id: string;
  run_id: string;
  attempt_id: string | null;
  category: string;
  subject: string;
  summary: string;
  source: RunImpactItem["source"];
  verification: RunImpactItem["verification"];
  confidence: number | null;
  evidence_json: string;
  created_at: string;
}

function mapRunImpactItem(row: RunImpactItemRow): RunImpactItem {
  return {
    id: row.id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    category: row.category,
    subject: row.subject,
    summary: row.summary,
    source: row.source,
    verification: row.verification,
    confidence: row.confidence,
    evidenceJson: row.evidence_json,
    createdAt: row.created_at,
  };
}

interface RunIntegrationRow {
  id: string;
  run_id: string;
  attempt_id: string | null;
  mode: string;
  provider: string | null;
  api_url: string | null;
  repo: string | null;
  pr_number: number | null;
  pr_url: string | null;
  status: RunIntegration["status"];
  auto_merge_requested: number;
  commit_sha: string | null;
  opened_at: string | null;
  merged_at: string | null;
  closed_at: string | null;
  check_count: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function mapRunIntegration(row: RunIntegrationRow): RunIntegration {
  return {
    id: row.id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    mode: row.mode,
    provider: row.provider,
    apiUrl: row.api_url,
    repo: row.repo,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    status: row.status,
    autoMergeRequested: boolFromInt(row.auto_merge_requested),
    commitSha: row.commit_sha,
    openedAt: row.opened_at,
    mergedAt: row.merged_at,
    closedAt: row.closed_at,
    checkCount: row.check_count,
    lastCheckedAt: row.last_checked_at,
    nextCheckAt: row.next_check_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ProjectRepository {
  create(input: CreateProjectInput): Project;
  findById(id: string): Project | null;
  list(): Project[];
  update(id: string, input: UpdateProjectInput): Project | null;
  delete(id: string): boolean;
}

export interface AgentRepository {
  create(input: CreateAgentInput): Agent;
  findById(id: string): Agent | null;
  findEnabledByProjectAndName(projectId: string, name: string): Agent | null;
  listByProject(projectId: string): Agent[];
  listAll(): Agent[];
  count(): number;
  update(id: string, input: UpdateAgentInput): Agent | null;
  delete(id: string): boolean;
}

export interface ScheduleRepository {
  create(input: CreateScheduleInput): Schedule;
  findById(id: string): Schedule | null;
  listByAgent(agentId: string): Schedule[];
  listDue(nowIso: string): Schedule[];
  count(): number;
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
  listAll(): Run[];
  count(): number;
  listNonTerminal(): Run[];
  /** Queued/Scheduled runs waiting for admission, ordered for the dispatcher. */
  listQueued(): Run[];
  /** Runs currently occupying an execution slot, keyed by projectId. */
  countRunningByProject(): Record<string, number>;
  /** Most recent admission timestamp across all runs. */
  latestAdmittedAt(): string | null;
  /** Count trailing failed/timed-out/infra-failure runs for an agent (stops at first success). */
  countConsecutiveFailuresForAgent(agentId: string, lookback: number): number;
  countByProjectTriggerSince(
    projectId: string,
    trigger: Run["trigger"],
    since: string,
  ): number;
  /** Non-terminal runs for a schedule (overlap policy). */
  countActiveBySchedule(scheduleId: string): number;
  countQueuedBySchedule(scheduleId: string): number;
  update(id: string, input: UpdateRunInput): Run | null;
  delete(id: string): boolean;
}

export interface ProfileRepository {
  create(input: CreateProfileInput): Profile;
  findById(id: string): Profile | null;
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

export interface RunImpactItemRepository {
  /** Idempotently replace all impact items for a run (safe on retries). */
  replaceForRun(
    runId: string,
    attemptId: string | null,
    items: RunImpactItemDraft[],
  ): RunImpactItem[];
  listByRun(runId: string): RunImpactItem[];
}

export interface RunIntegrationRepository {
  /** One canonical integration outcome per run; upsert keyed on run_id. */
  upsertForRun(input: UpsertRunIntegrationInput): RunIntegration;
  findByRun(runId: string): RunIntegration | null;
  /** Nonterminal rows due for reconciliation, oldest check first. */
  listDue(nowIso: string, limit: number): RunIntegration[];
  update(id: string, input: UpdateRunIntegrationInput): RunIntegration | null;
}

export interface Repositories {
  projects: ProjectRepository;
  agents: AgentRepository;
  schedules: ScheduleRepository;
  runs: RunRepository;
  attempts: AttemptRepository;
  audit: AuditRepository;
  secrets: SecretRepository;
  profiles: ProfileRepository;
  runImpactItems: RunImpactItemRepository;
  runIntegrations: RunIntegrationRepository;
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

  const agents: AgentRepository = {
    create(input) {
      const id = ulid();
      const createdAt = nowIso();

      sqlite
        .query(
          `INSERT INTO agents (
            id, project_id, name, description, profile_id, prompt,
            validation_profile_json, integration_json, failure_policy_json,
            concurrency_json, notifications_json, environment_json, trigger_json,
            enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.name,
          input.description ?? "",
          input.profileId ?? null,
          input.prompt,
          input.validationProfileJson ?? "{}",
          input.integrationJson ?? "{}",
          input.failurePolicyJson ?? "{}",
          input.concurrencyJson ?? "{}",
          input.notificationsJson ?? "{}",
          input.environmentJson ?? "{}",
          input.triggerJson ?? "{}",
          intFromBool(input.enabled ?? true),
          createdAt,
        );

      return mapAgent({
        id,
        project_id: input.projectId,
        name: input.name,
        description: input.description ?? "",
        profile_id: input.profileId ?? null,
        prompt: input.prompt,
        validation_profile_json: input.validationProfileJson ?? "{}",
        integration_json: input.integrationJson ?? "{}",
        failure_policy_json: input.failurePolicyJson ?? "{}",
        concurrency_json: input.concurrencyJson ?? "{}",
        notifications_json: input.notificationsJson ?? "{}",
        environment_json: input.environmentJson ?? "{}",
        trigger_json: input.triggerJson ?? "{}",
        enabled: intFromBool(input.enabled ?? true),
        created_at: createdAt,
      });
    },

    findById(id) {
      const row = sqlite.query<AgentRow, [string]>("SELECT * FROM agents WHERE id = ?").get(id);
      return row ? mapAgent(row) : null;
    },

    findEnabledByProjectAndName(projectId, name) {
      const row = sqlite
        .query<AgentRow, [string, string]>(
          "SELECT * FROM agents WHERE project_id = ? AND name = ? AND enabled = 1",
        )
        .get(projectId, name);
      return row ? mapAgent(row) : null;
    },

    listByProject(projectId) {
      const rows = sqlite
        .query<AgentRow, [string]>(
          "SELECT * FROM agents WHERE project_id = ? ORDER BY name ASC, project_id ASC",
        )
        .all(projectId);
      return rows.map(mapAgent);
    },

    listAll() {
      const rows = sqlite
        .query<AgentRow, []>("SELECT * FROM agents ORDER BY name ASC, project_id ASC")
        .all();
      return rows.map(mapAgent);
    },

    count() {
      const row = sqlite.query<{ count: number }, []>("SELECT COUNT(*) as count FROM agents").get();
      return row?.count ?? 0;
    },

    update(id, input) {
      const existing = this.findById(id);
      if (!existing) {
        return null;
      }

      const next: Agent = {
        ...existing,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        profileId:
          input.profileId !== undefined ? input.profileId : existing.profileId,
        prompt: input.prompt ?? existing.prompt,
        validationProfileJson: input.validationProfileJson ?? existing.validationProfileJson,
        integrationJson: input.integrationJson ?? existing.integrationJson,
        failurePolicyJson: input.failurePolicyJson ?? existing.failurePolicyJson,
        concurrencyJson: input.concurrencyJson ?? existing.concurrencyJson,
        notificationsJson: input.notificationsJson ?? existing.notificationsJson,
        environmentJson: input.environmentJson ?? existing.environmentJson,
        triggerJson: input.triggerJson ?? existing.triggerJson,
        enabled: input.enabled ?? existing.enabled,
      };

      sqlite
        .query(
          `UPDATE agents SET
            name = ?, description = ?, profile_id = ?, prompt = ?,
            validation_profile_json = ?, integration_json = ?, failure_policy_json = ?,
            concurrency_json = ?, notifications_json = ?, environment_json = ?,
            trigger_json = ?, enabled = ?
          WHERE id = ?`,
        )
        .run(
          next.name,
          next.description,
          next.profileId,
          next.prompt,
          next.validationProfileJson,
          next.integrationJson,
          next.failurePolicyJson,
          next.concurrencyJson,
          next.notificationsJson,
          next.environmentJson,
          next.triggerJson,
          intFromBool(next.enabled),
          id,
        );

      return next;
    },

    delete(id) {
      const result = sqlite.query("DELETE FROM agents WHERE id = ?").run(id);
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
            id, agent_id, name, cron_expr, timezone, enabled, overlap_policy,
            missed_run_policy, retry_json, consecutive_failures, disable_after,
            next_run_at, last_run_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)`,
        )
        .run(
          id,
          input.agentId,
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
        agent_id: input.agentId,
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

    listByAgent(agentId) {
      const rows = sqlite
        .query<ScheduleRow, [string]>("SELECT * FROM schedules WHERE agent_id = ? ORDER BY created_at")
        .all(agentId);
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

    count() {
      const row = sqlite
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM schedules")
        .get();
      return row?.count ?? 0;
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
      const notBeforeAt = input.notBeforeAt ?? createdAt;
      const expiresAt = input.expiresAt ?? null;
      const priority = input.priority ?? 30;

      sqlite
        .query(
          `INSERT INTO runs (
            id, project_id, agent_id, schedule_id, state, idempotency_key,
            trigger, created_at, started_at, finished_at, error_message,
            not_before_at, expires_at, admitted_at, priority, work_item_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.agentId,
          input.scheduleId ?? null,
          state,
          input.idempotencyKey,
          input.trigger,
          createdAt,
          notBeforeAt,
          expiresAt,
          priority,
          input.workItemId ?? null,
        );

      return mapRun({
        id,
        project_id: input.projectId,
        agent_id: input.agentId,
        schedule_id: input.scheduleId ?? null,
        state,
        idempotency_key: input.idempotencyKey,
        trigger: input.trigger,
        created_at: createdAt,
        started_at: null,
        finished_at: null,
        error_message: null,
        not_before_at: notBeforeAt,
        expires_at: expiresAt,
        admitted_at: null,
        priority,
        work_item_id: input.workItemId ?? null,
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

    listAll() {
      const rows = sqlite
        .query<RunRow, []>("SELECT * FROM runs ORDER BY created_at DESC")
        .all();
      return rows.map(mapRun);
    },

    count() {
      const row = sqlite.query<{ count: number }, []>("SELECT COUNT(*) as count FROM runs").get();
      return row?.count ?? 0;
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

    listQueued() {
      const rows = sqlite
        .query<RunRow, []>(
          `SELECT * FROM runs
           WHERE state IN ('Queued', 'Scheduled')
           ORDER BY priority ASC,
             COALESCE(not_before_at, created_at) ASC,
             created_at ASC`,
        )
        .all();
      return rows.map(mapRun);
    },

    countRunningByProject() {
      const rows = sqlite
        .query<{ project_id: string; count: number }, []>(
          `SELECT project_id, COUNT(*) as count FROM runs
           WHERE state IN (
             'Preparing', 'Running', 'Validating', 'AwaitingApproval',
             'Integrating', 'Reporting'
           )
           GROUP BY project_id`,
        )
        .all();
      const out: Record<string, number> = {};
      for (const row of rows) {
        out[row.project_id] = row.count;
      }
      return out;
    },

    latestAdmittedAt() {
      const row = sqlite
        .query<{ admitted_at: string }, []>(
          `SELECT admitted_at FROM runs
           WHERE admitted_at IS NOT NULL
           ORDER BY admitted_at DESC
           LIMIT 1`,
        )
        .get();
      return row?.admitted_at ?? null;
    },

    countConsecutiveFailuresForAgent(agentId, lookback) {
      const rows = sqlite
        .query<{ state: Run["state"] }, [string, number]>(
          `SELECT state FROM runs
           WHERE agent_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(agentId, Math.max(lookback * 5, 10));

      let consecutive = 0;
      for (const row of rows) {
        if (
          row.state === RunState.Failed ||
          row.state === RunState.TimedOut ||
          row.state === RunState.InfrastructureFailure
        ) {
          consecutive += 1;
        } else if (row.state === RunState.Succeeded) {
          break;
        }
      }
      return consecutive;
    },

    countByProjectTriggerSince(projectId, trigger, since) {
      const row = sqlite
        .query<{ count: number }, [string, string, string]>(
          `SELECT COUNT(*) as count FROM runs
           WHERE project_id = ? AND trigger = ? AND created_at >= ?`,
        )
        .get(projectId, trigger, since);
      return row?.count ?? 0;
    },

    countActiveBySchedule(scheduleId) {
      const row = sqlite
        .query<{ count: number }, [string]>(
          `SELECT COUNT(*) as count FROM runs
           WHERE schedule_id = ? AND state NOT IN (
             'Succeeded', 'Failed', 'Canceled', 'TimedOut', 'Skipped',
             'Superseded', 'Abandoned', 'Blocked', 'Conflict', 'InfrastructureFailure'
           )`,
        )
        .get(scheduleId);
      return row?.count ?? 0;
    },

    countQueuedBySchedule(scheduleId) {
      const row = sqlite
        .query<{ count: number }, [string, string]>(
          "SELECT COUNT(*) as count FROM runs WHERE schedule_id = ? AND state = ?",
        )
        .get(scheduleId, RunState.Queued);
      return row?.count ?? 0;
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
        admittedAt: input.admittedAt !== undefined ? input.admittedAt : existing.admittedAt,
        notBeforeAt: input.notBeforeAt !== undefined ? input.notBeforeAt : existing.notBeforeAt,
        expiresAt: input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt,
        priority: input.priority !== undefined ? input.priority : existing.priority,
        workItemId:
          input.workItemId !== undefined ? input.workItemId : existing.workItemId,
      };

      sqlite
        .query(
          `UPDATE runs SET state = ?, started_at = ?, finished_at = ?, error_message = ?,
           admitted_at = ?, not_before_at = ?, expires_at = ?, priority = ?,
           work_item_id = ? WHERE id = ?`,
        )
        .run(
          next.state,
          next.startedAt,
          next.finishedAt,
          next.errorMessage,
          next.admittedAt,
          next.notBeforeAt,
          next.expiresAt,
          next.priority,
          next.workItemId,
          id,
        );

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
            starting_commit, result_commit, agent_version, agent_adapter, exit_code,
            handoff_json, started_at, finished_at,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            total_cost_usd, cost_source, usage_json, model, agent_duration_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL,
            NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
        )
        .run(
          id,
          input.runId,
          input.attemptNumber,
          state,
          input.workspacePath ?? null,
          input.branchName ?? null,
          input.startingCommit ?? null,
          input.agentAdapter ?? null,
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
        pr_url: null,
        agent_version: null,
        agent_adapter: input.agentAdapter ?? null,
        exit_code: null,
        handoff_json: null,
        started_at: null,
        finished_at: null,
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
        total_cost_usd: null,
        cost_source: null,
        usage_json: null,
        model: null,
        agent_duration_ms: null,
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
        prUrl: input.prUrl !== undefined ? input.prUrl : existing.prUrl,
        agentVersion:
          input.agentVersion !== undefined ? input.agentVersion : existing.agentVersion,
        exitCode: input.exitCode !== undefined ? input.exitCode : existing.exitCode,
        handoffJson: input.handoffJson !== undefined ? input.handoffJson : existing.handoffJson,
        startedAt: input.startedAt !== undefined ? input.startedAt : existing.startedAt,
        finishedAt: input.finishedAt !== undefined ? input.finishedAt : existing.finishedAt,
        inputTokens: input.inputTokens !== undefined ? input.inputTokens : existing.inputTokens,
        outputTokens:
          input.outputTokens !== undefined ? input.outputTokens : existing.outputTokens,
        cacheReadTokens:
          input.cacheReadTokens !== undefined ? input.cacheReadTokens : existing.cacheReadTokens,
        cacheWriteTokens:
          input.cacheWriteTokens !== undefined
            ? input.cacheWriteTokens
            : existing.cacheWriteTokens,
        totalCostUsd:
          input.totalCostUsd !== undefined ? input.totalCostUsd : existing.totalCostUsd,
        costSource: input.costSource !== undefined ? input.costSource : existing.costSource,
        usageJson: input.usageJson !== undefined ? input.usageJson : existing.usageJson,
        model: input.model !== undefined ? input.model : existing.model,
        agentDurationMs:
          input.agentDurationMs !== undefined ? input.agentDurationMs : existing.agentDurationMs,
      };

      sqlite
        .query(
          `UPDATE attempts SET
            state = ?, workspace_path = ?, branch_name = ?, starting_commit = ?,
            result_commit = ?, pr_url = ?, agent_version = ?, exit_code = ?, handoff_json = ?,
            started_at = ?, finished_at = ?,
            input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?,
            total_cost_usd = ?, cost_source = ?, usage_json = ?, model = ?, agent_duration_ms = ?
          WHERE id = ?`,
        )
        .run(
          next.state,
          next.workspacePath,
          next.branchName,
          next.startingCommit,
          next.resultCommit,
          next.prUrl,
          next.agentVersion,
          next.exitCode,
          next.handoffJson,
          next.startedAt,
          next.finishedAt,
          next.inputTokens,
          next.outputTokens,
          next.cacheReadTokens,
          next.cacheWriteTokens,
          next.totalCostUsd,
          next.costSource,
          next.usageJson,
          next.model,
          next.agentDurationMs,
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

  const profiles: ProfileRepository = {
    create(input) {
      const createdAt = nowIso();
      const configJson = input.configJson ?? "{}";
      const projectId = input.projectId ?? null;
      const existing =
        projectId === null
          ? sqlite
              .query<ProfileRow, [string]>(
                "SELECT * FROM profiles WHERE project_id IS NULL AND name = ? ORDER BY created_at LIMIT 1",
              )
              .get(input.name)
          : sqlite
              .query<ProfileRow, [string, string]>(
                "SELECT * FROM profiles WHERE project_id = ? AND name = ? ORDER BY created_at LIMIT 1",
              )
              .get(projectId, input.name);
      if (existing) {
        sqlite
          .query("UPDATE profiles SET adapter = ?, config_json = ? WHERE id = ?")
          .run(input.adapter, configJson, existing.id);
        return mapProfile({
          ...existing,
          adapter: input.adapter,
          config_json: configJson,
        });
      }

      const id = ulid();
      sqlite
        .query(
          `INSERT INTO profiles (id, project_id, name, adapter, config_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, projectId, input.name, input.adapter, configJson, createdAt);

      return mapProfile({
        id,
        project_id: projectId,
        name: input.name,
        adapter: input.adapter,
        config_json: configJson,
        created_at: createdAt,
      });
    },

    findById(id) {
      const row = sqlite
        .query<ProfileRow, [string]>("SELECT * FROM profiles WHERE id = ?")
        .get(id);
      return row ? mapProfile(row) : null;
    },
  };

  const runImpactItems: RunImpactItemRepository = {
    replaceForRun(runId, attemptId, items) {
      return db.transaction(() => {
        sqlite.query("DELETE FROM run_impact_items WHERE run_id = ?").run(runId);

        const created: RunImpactItem[] = [];
        for (const item of items) {
          const id = ulid();
          const createdAt = nowIso();
          const evidenceJson = item.evidenceJson ?? "{}";
          sqlite
            .query(
              `INSERT INTO run_impact_items (
                id, run_id, attempt_id, category, subject, summary,
                source, verification, confidence, evidence_json, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(run_id, category, subject) DO NOTHING`,
            )
            .run(
              id,
              runId,
              attemptId,
              item.category,
              item.subject,
              item.summary,
              item.source,
              item.verification,
              item.confidence ?? null,
              evidenceJson,
              createdAt,
            );
          const row = sqlite
            .query<RunImpactItemRow, [string]>("SELECT * FROM run_impact_items WHERE id = ?")
            .get(id);
          if (row) {
            created.push(mapRunImpactItem(row));
          }
        }
        return created;
      });
    },

    listByRun(runId) {
      const rows = sqlite
        .query<RunImpactItemRow, [string]>(
          "SELECT * FROM run_impact_items WHERE run_id = ? ORDER BY category, subject",
        )
        .all(runId);
      return rows.map(mapRunImpactItem);
    },
  };

  const runIntegrations: RunIntegrationRepository = {
    upsertForRun(input) {
      const now = nowIso();
      const existing = this.findByRun(input.runId);

      if (existing) {
        sqlite
          .query(
            `UPDATE run_integrations SET
              attempt_id = ?, mode = ?, provider = ?, api_url = ?, repo = ?,
              pr_number = ?, pr_url = ?, status = ?, auto_merge_requested = ?,
              commit_sha = ?, opened_at = ?, merged_at = ?, closed_at = ?,
              next_check_at = ?, updated_at = ?
            WHERE id = ?`,
          )
          .run(
            input.attemptId ?? existing.attemptId,
            input.mode,
            input.provider ?? existing.provider,
            input.apiUrl ?? existing.apiUrl,
            input.repo ?? existing.repo,
            input.prNumber ?? existing.prNumber,
            input.prUrl ?? existing.prUrl,
            input.status,
            intFromBool(input.autoMergeRequested ?? existing.autoMergeRequested),
            input.commitSha ?? existing.commitSha,
            input.openedAt ?? existing.openedAt,
            input.mergedAt ?? existing.mergedAt,
            input.closedAt ?? existing.closedAt,
            input.nextCheckAt !== undefined ? input.nextCheckAt : existing.nextCheckAt,
            now,
            existing.id,
          );
        return this.findByRun(input.runId) ?? existing;
      }

      const id = ulid();
      sqlite
        .query(
          `INSERT INTO run_integrations (
            id, run_id, attempt_id, mode, provider, api_url, repo,
            pr_number, pr_url, status, auto_merge_requested, commit_sha,
            opened_at, merged_at, closed_at, check_count,
            last_checked_at, next_check_at, last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?, ?)`,
        )
        .run(
          id,
          input.runId,
          input.attemptId ?? null,
          input.mode,
          input.provider ?? null,
          input.apiUrl ?? null,
          input.repo ?? null,
          input.prNumber ?? null,
          input.prUrl ?? null,
          input.status,
          intFromBool(input.autoMergeRequested ?? false),
          input.commitSha ?? null,
          input.openedAt ?? null,
          input.mergedAt ?? null,
          input.closedAt ?? null,
          input.nextCheckAt ?? null,
          now,
          now,
        );

      const row = sqlite
        .query<RunIntegrationRow, [string]>("SELECT * FROM run_integrations WHERE id = ?")
        .get(id);
      if (!row) {
        throw new Error("Failed to insert run integration");
      }
      return mapRunIntegration(row);
    },

    findByRun(runId) {
      const row = sqlite
        .query<RunIntegrationRow, [string]>(
          "SELECT * FROM run_integrations WHERE run_id = ?",
        )
        .get(runId);
      return row ? mapRunIntegration(row) : null;
    },

    listDue(nowIso, limit) {
      const rows = sqlite
        .query<RunIntegrationRow, [string, number]>(
          `SELECT * FROM run_integrations
           WHERE status IN ('open', 'unknown')
             AND next_check_at IS NOT NULL
             AND next_check_at <= ?
           ORDER BY next_check_at ASC
           LIMIT ?`,
        )
        .all(nowIso, limit);
      return rows.map(mapRunIntegration);
    },

    update(id, input) {
      const row = sqlite
        .query<RunIntegrationRow, [string]>("SELECT * FROM run_integrations WHERE id = ?")
        .get(id);
      if (!row) {
        return null;
      }
      const existing = mapRunIntegration(row);
      const next: RunIntegration = {
        ...existing,
        status: input.status ?? existing.status,
        mergedAt: input.mergedAt !== undefined ? input.mergedAt : existing.mergedAt,
        closedAt: input.closedAt !== undefined ? input.closedAt : existing.closedAt,
        checkCount: input.checkCount ?? existing.checkCount,
        lastCheckedAt:
          input.lastCheckedAt !== undefined ? input.lastCheckedAt : existing.lastCheckedAt,
        nextCheckAt:
          input.nextCheckAt !== undefined ? input.nextCheckAt : existing.nextCheckAt,
        lastError: input.lastError !== undefined ? input.lastError : existing.lastError,
        updatedAt: nowIso(),
      };

      sqlite
        .query(
          `UPDATE run_integrations SET
            status = ?, merged_at = ?, closed_at = ?, check_count = ?,
            last_checked_at = ?, next_check_at = ?, last_error = ?, updated_at = ?
          WHERE id = ?`,
        )
        .run(
          next.status,
          next.mergedAt,
          next.closedAt,
          next.checkCount,
          next.lastCheckedAt,
          next.nextCheckAt,
          next.lastError,
          next.updatedAt,
          id,
        );

      return next;
    },
  };

  return {
    projects,
    agents,
    schedules,
    runs,
    attempts,
    audit,
    secrets,
    profiles,
    runImpactItems,
    runIntegrations,
  };
}
