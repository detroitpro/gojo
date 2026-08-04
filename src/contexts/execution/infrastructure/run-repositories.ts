/** Execution SQLite repositories (runs/attempts/impact items). */
import { ulid } from "ulid";

import { RunState } from "@shared/run-states";

import type { Database } from "@/infrastructure/persistence/db";
import type {
  Attempt,
  CreateAttemptInput,
  CreateRunInput,
  Run,
  RunImpactItem,
  RunImpactItemDraft,
  UpdateAttemptInput,
  UpdateRunInput,
} from "@/infrastructure/persistence/types";

function nowIso(): string {
  return new Date().toISOString();
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

export interface AttemptRepository {
  create(input: CreateAttemptInput): Attempt;
  findById(id: string): Attempt | null;
  listByRun(runId: string): Attempt[];
  update(id: string, input: UpdateAttemptInput): Attempt | null;
  delete(id: string): boolean;
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


export function createRunRepositories(db: Database): {
  runs: RunRepository;
  attempts: AttemptRepository;
  runImpactItems: RunImpactItemRepository;
} {
  const sqlite = db.connection();

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


  return { runs, attempts, runImpactItems };
}
