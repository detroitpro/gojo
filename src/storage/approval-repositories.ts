import { ulid } from 'ulid';

import {
  ApprovalSchema,
  ControlIntentSchema,
  type Approval,
  type ApprovalState,
  type ChecksState,
  type ControlIntent,
  type CreateApproval,
  type ReviewVerdict,
  type SubmitControlIntent,
} from '@shared/approvals';
import type { PaginatedList } from '@shared/pagination';

import { parseJsonObject } from '@shared/json';

import type { Database } from './db';

interface ApprovalRow {
  id: string;
  project_id: string;
  subject_type: string;
  subject_id: string;
  run_id: string | null;
  work_item_id: string | null;
  reason: string;
  autonomy: string;
  state: string;
  review_verdict: string | null;
  checks_state: string | null;
  evidence_json: string;
  decided_by: string | null;
  decided_via: string | null;
  note: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface ControlIntentRow {
  id: string;
  project_id: string;
  kind: string;
  target_type: string;
  target_id: string;
  actor: string;
  surface: string;
  surface_ref: string | null;
  note: string | null;
  state: string;
  error: string | null;
  created_at: string;
}

function mapApproval(row: ApprovalRow): Approval {
  return ApprovalSchema.parse({
    id: row.id,
    projectId: row.project_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    runId: row.run_id,
    workItemId: row.work_item_id,
    reason: row.reason,
    autonomy: row.autonomy,
    state: row.state,
    reviewVerdict: row.review_verdict,
    checksState: row.checks_state,
    evidence: parseJsonObject(row.evidence_json),
    decidedBy: row.decided_by,
    decidedVia: row.decided_via,
    note: row.note,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapControlIntent(row: ControlIntentRow): ControlIntent {
  return ControlIntentSchema.parse({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    targetType: row.target_type,
    targetId: row.target_id,
    actor: row.actor,
    surface: row.surface,
    surfaceRef: row.surface_ref,
    note: row.note,
    state: row.state,
    error: row.error,
    createdAt: row.created_at,
  });
}

export interface UpdateApprovalInput {
  runId?: string | null;
  workItemId?: string | null;
  state?: ApprovalState;
  reviewVerdict?: ReviewVerdict | null;
  checksState?: ChecksState | null;
  evidence?: Record<string, unknown>;
  decidedBy?: string | null;
  decidedVia?: string | null;
  note?: string | null;
  attempts?: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
}

export function createApprovalRepository(db: Database) {
  const sqlite = db.connection();

  return {
    create(input: CreateApproval): Approval {
      const existing = this.findBySubject(input.subjectType, input.subjectId);
      if (existing) return existing;
      const id = ulid();
      const now = new Date().toISOString();
      sqlite
        .query(
          `INSERT INTO approvals (
            id, project_id, subject_type, subject_id, run_id, work_item_id,
            reason, autonomy, state, review_verdict, checks_state, evidence_json,
            attempts, next_attempt_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.subjectType,
          input.subjectId,
          input.runId ?? null,
          input.workItemId ?? null,
          input.reason ?? '',
          input.autonomy,
          input.state ?? 'pending-review',
          input.reviewVerdict ?? null,
          input.checksState ?? null,
          JSON.stringify(input.evidence ?? {}),
          input.attempts ?? 0,
          input.nextAttemptAt ?? null,
          now,
          now,
        );
      return this.findById(id)!;
    },

    findById(id: string): Approval | null {
      const row = sqlite
        .query<ApprovalRow, [string]>('SELECT * FROM approvals WHERE id = ?')
        .get(id);
      return row ? mapApproval(row) : null;
    },

    findBySubject(subjectType: string, subjectId: string): Approval | null {
      const row = sqlite
        .query<ApprovalRow, [string, string]>(
          'SELECT * FROM approvals WHERE subject_type = ? AND subject_id = ?',
        )
        .get(subjectType, subjectId);
      return row ? mapApproval(row) : null;
    },

    findByRun(runId: string): Approval | null {
      const row = sqlite
        .query<ApprovalRow, [string]>(
          "SELECT * FROM approvals WHERE run_id = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .get(runId);
      return row ? mapApproval(row) : null;
    },

    list(input: {
      projectId?: string;
      state?: ApprovalState;
      subjectType?: string;
      limit: number;
      offset: number;
    }): PaginatedList<Approval> {
      const where: string[] = [];
      const params: string[] = [];
      if (input.projectId) {
        where.push('project_id = ?');
        params.push(input.projectId);
      }
      if (input.state) {
        where.push('state = ?');
        params.push(input.state);
      }
      if (input.subjectType) {
        where.push('subject_type = ?');
        params.push(input.subjectType);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const count = sqlite
        .query<{ count: number }, string[]>(
          `SELECT COUNT(*) AS count FROM approvals ${clause}`,
        )
        .get(...params)?.count ?? 0;
      const rows = sqlite
        .query<ApprovalRow, Array<string | number>>(
          `SELECT * FROM approvals ${clause}
           ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, input.limit, input.offset);
      return {
        items: rows.map(mapApproval),
        total: count,
        limit: input.limit,
        offset: input.offset,
      };
    },

    update(id: string, input: UpdateApprovalInput): Approval | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const next = {
        runId: input.runId !== undefined ? input.runId : (existing.runId ?? null),
        workItemId:
          input.workItemId !== undefined
            ? input.workItemId
            : (existing.workItemId ?? null),
        state: input.state ?? existing.state,
        reviewVerdict:
          input.reviewVerdict !== undefined ? input.reviewVerdict : existing.reviewVerdict,
        checksState: input.checksState !== undefined ? input.checksState : existing.checksState,
        evidence: input.evidence ?? existing.evidence,
        decidedBy: input.decidedBy !== undefined ? input.decidedBy : existing.decidedBy,
        decidedVia: input.decidedVia !== undefined ? input.decidedVia : existing.decidedVia,
        note: input.note !== undefined ? input.note : existing.note,
        attempts: input.attempts ?? existing.attempts,
        nextAttemptAt:
          input.nextAttemptAt !== undefined ? input.nextAttemptAt : existing.nextAttemptAt,
        lastError: input.lastError !== undefined ? input.lastError : existing.lastError,
      };
      sqlite
        .query(
          `UPDATE approvals SET run_id = ?, work_item_id = ?, state = ?, review_verdict = ?, checks_state = ?,
           evidence_json = ?, decided_by = ?, decided_via = ?, note = ?,
           attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          next.runId,
          next.workItemId,
          next.state,
          next.reviewVerdict,
          next.checksState,
          JSON.stringify(next.evidence),
          next.decidedBy,
          next.decidedVia,
          next.note,
          next.attempts,
          next.nextAttemptAt,
          next.lastError,
          new Date().toISOString(),
          id,
        );
      return this.findById(id);
    },
  };
}

export function createControlIntentRepository(db: Database) {
  const sqlite = db.connection();

  return {
    create(
      input: SubmitControlIntent & {
        state: ControlIntent['state'];
        error?: string | null;
      },
    ): ControlIntent {
      if (input.surfaceRef) {
        const existing = this.findBySurfaceRef(input.surface, input.surfaceRef);
        if (existing) return existing;
      }
      const id = ulid();
      const createdAt = new Date().toISOString();
      sqlite
        .query(
          `INSERT INTO control_intents (
            id, project_id, kind, target_type, target_id, actor, surface,
            surface_ref, note, state, error, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.kind,
          input.targetType,
          input.targetId,
          input.actor,
          input.surface,
          input.surfaceRef ?? null,
          input.note ?? null,
          input.state,
          input.error ?? null,
          createdAt,
        );
      return this.findById(id)!;
    },

    findById(id: string): ControlIntent | null {
      const row = sqlite
        .query<ControlIntentRow, [string]>('SELECT * FROM control_intents WHERE id = ?')
        .get(id);
      return row ? mapControlIntent(row) : null;
    },

    findBySurfaceRef(surface: string, surfaceRef: string): ControlIntent | null {
      const row = sqlite
        .query<ControlIntentRow, [string, string]>(
          'SELECT * FROM control_intents WHERE surface = ? AND surface_ref = ?',
        )
        .get(surface, surfaceRef);
      return row ? mapControlIntent(row) : null;
    },

    listByTarget(targetType: string, targetId: string): ControlIntent[] {
      return sqlite
        .query<ControlIntentRow, [string, string]>(
          `SELECT * FROM control_intents
           WHERE target_type = ? AND target_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .all(targetType, targetId)
        .map(mapControlIntent);
    },
  };
}

export type ApprovalRepository = ReturnType<typeof createApprovalRepository>;
export type ControlIntentRepository = ReturnType<typeof createControlIntentRepository>;
