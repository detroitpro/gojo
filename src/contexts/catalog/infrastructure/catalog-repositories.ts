/** Catalog entity SQLite repositories (projects/agents/schedules/profiles). */
import { ulid } from "ulid";

import type { Database } from "@/infrastructure/persistence/db";
import type {
  Agent,
  CreateAgentInput,
  CreateProfileInput,
  CreateProjectInput,
  CreateScheduleInput,
  Profile,
  Project,
  Schedule,
  UpdateAgentInput,
  UpdateProjectInput,
  UpdateScheduleInput,
} from "@/infrastructure/persistence/types";

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

export interface ProfileRepository {
  create(input: CreateProfileInput): Profile;
  findById(id: string): Profile | null;
}


export function createCatalogRepositories(db: Database): {
  projects: ProjectRepository;
  agents: AgentRepository;
  schedules: ScheduleRepository;
  profiles: ProfileRepository;
} {
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


  return { projects, agents, schedules, profiles };
}
