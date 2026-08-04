import type { WorkStatusCounts } from "@shared/work";

import type { Database } from "@/infrastructure/persistence/db";
import {
  countWorkStateAt,
  countWorkStateAtByKind,
  emptyWorkStatusCounts,
  hourBucketAt,
  mapStatusCountsRow,
  previousClosedHour,
  sumWorkStatusCounts,
} from "@/contexts/work/infrastructure/work-status-counts";

export type WorkStatusRollup = {
  countsAt(projectId: string, at: string): WorkStatusCounts;
  countsAtKind(kind: string, at: string): WorkStatusCounts;
  materializeClosedHour(projectId: string, now?: string): void;
  rebuild(input?: { projectId?: string; from?: string }): number;
};

type RollupRow = {
  project_id: string;
  kind: string;
  bucket_at: string;
  working: number;
  queued: number;
  needs_attention: number;
  verified_open: number;
  stale_open: number;
  computed_at: string;
};

function upsertKindBucket(
  db: Database,
  input: {
    projectId: string;
    kind: string;
    bucketAt: string;
    counts: WorkStatusCounts;
    computedAt: string;
  },
): void {
  db.connection()
    .query(
      `INSERT INTO work_status_rollup (
         project_id, kind, bucket_at, working, queued, needs_attention,
         verified_open, stale_open, computed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, kind, bucket_at) DO UPDATE SET
         working = excluded.working,
         queued = excluded.queued,
         needs_attention = excluded.needs_attention,
         verified_open = excluded.verified_open,
         stale_open = excluded.stale_open,
         computed_at = excluded.computed_at`,
    )
    .run(
      input.projectId,
      input.kind,
      input.bucketAt,
      input.counts.working,
      input.counts.queued,
      input.counts.needsAttention,
      input.counts.verifiedOpen,
      input.counts.staleOpen,
      input.computedAt,
    );
}

function materializeProjectBucket(
  db: Database,
  projectId: string,
  bucketAt: string,
  computedAt: string,
): WorkStatusCounts {
  const byKind = countWorkStateAtByKind(db, { projectId, at: bucketAt });
  if (byKind.length === 0) {
    // Persist a sentinel-free empty project: no rows means zeros on read.
    return emptyWorkStatusCounts();
  }
  for (const entry of byKind) {
    upsertKindBucket(db, {
      projectId,
      kind: entry.kind,
      bucketAt,
      counts: entry.counts,
      computedAt,
    });
  }
  return sumWorkStatusCounts(byKind.map((entry) => entry.counts));
}

function readProjectBucket(
  db: Database,
  projectId: string,
  bucketAt: string,
): WorkStatusCounts | null {
  const rows = db
    .connection()
    .query<RollupRow, [string, string]>(
      `SELECT * FROM work_status_rollup
       WHERE project_id = ? AND bucket_at = ?`,
    )
    .all(projectId, bucketAt);
  if (rows.length === 0) return null;
  return sumWorkStatusCounts(rows.map((row) => mapStatusCountsRow(row)));
}

function bucketExists(
  db: Database,
  projectId: string,
  bucketAt: string,
): boolean {
  const row = db
    .connection()
    .query<{ n: number }, [string, string]>(
      `SELECT COUNT(*) AS n FROM work_status_rollup
       WHERE project_id = ? AND bucket_at = ?`,
    )
    .get(projectId, bucketAt);
  return (row?.n ?? 0) > 0;
}

export function createWorkStatusRollup(db: Database): WorkStatusRollup {
  return {
    countsAt(projectId: string, at: string): WorkStatusCounts {
      const bucketAt = hourBucketAt(at);
      const cached = readProjectBucket(db, projectId, bucketAt);
      if (cached) return cached;
      return materializeProjectBucket(db, projectId, bucketAt, new Date().toISOString());
    },

    countsAtKind(kind: string, at: string): WorkStatusCounts {
      const bucketAt = hourBucketAt(at);
      const sqlite = db.connection();
      const existing = sqlite
        .query<RollupRow, [string, string]>(
          `SELECT * FROM work_status_rollup
           WHERE kind = ? AND bucket_at = ?`,
        )
        .all(kind, bucketAt);

      const projectIds = sqlite
        .query<{ id: string }, []>("SELECT id FROM projects")
        .all()
        .map((row) => row.id);

      const missing = projectIds.filter(
        (projectId) => !existing.some((row) => row.project_id === projectId),
      );
      const computedAt = new Date().toISOString();
      for (const projectId of missing) {
        // Materialize full project bucket so future project reads hit too.
        materializeProjectBucket(db, projectId, bucketAt, computedAt);
      }

      const rows = sqlite
        .query<RollupRow, [string, string]>(
          `SELECT * FROM work_status_rollup
           WHERE kind = ? AND bucket_at = ?`,
        )
        .all(kind, bucketAt);
      if (rows.length === 0) {
        // No projects or no state — fall back to direct replay for the kind.
        return countWorkStateAt(db, { kind, at: bucketAt });
      }
      return sumWorkStatusCounts(rows.map((row) => mapStatusCountsRow(row)));
    },

    materializeClosedHour(projectId: string, now = new Date().toISOString()): void {
      const closed = previousClosedHour(now);
      if (bucketExists(db, projectId, closed)) return;
      materializeProjectBucket(db, projectId, closed, now);
    },

    rebuild(input: { projectId?: string; from?: string } = {}): number {
      const sqlite = db.connection();
      if (input.projectId && input.from) {
        return sqlite
          .query(
            `DELETE FROM work_status_rollup
             WHERE project_id = ? AND bucket_at >= ?`,
          )
          .run(input.projectId, hourBucketAt(input.from)).changes;
      }
      if (input.projectId) {
        return sqlite
          .query("DELETE FROM work_status_rollup WHERE project_id = ?")
          .run(input.projectId).changes;
      }
      if (input.from) {
        return sqlite
          .query("DELETE FROM work_status_rollup WHERE bucket_at >= ?")
          .run(hourBucketAt(input.from)).changes;
      }
      return sqlite.query("DELETE FROM work_status_rollup").run().changes;
    },
  };
}
