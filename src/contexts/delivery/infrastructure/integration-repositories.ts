/** Delivery SQLite repository for run integrations. */
import { ulid } from "ulid";

import type { Database } from "@/infrastructure/persistence/db";
import type {
  RunIntegration,
  UpdateRunIntegrationInput,
  UpsertRunIntegrationInput,
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


export interface RunIntegrationRepository {
  /** One canonical integration outcome per run; upsert keyed on run_id. */
  upsertForRun(input: UpsertRunIntegrationInput): RunIntegration;
  findByRun(runId: string): RunIntegration | null;
  /** Nonterminal rows due for reconciliation, oldest check first. */
  listDue(nowIso: string, limit: number): RunIntegration[];
  update(id: string, input: UpdateRunIntegrationInput): RunIntegration | null;
}


export function createRunIntegrationRepository(db: Database): RunIntegrationRepository {
  const sqlite = db.connection();

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


  return runIntegrations;
}
