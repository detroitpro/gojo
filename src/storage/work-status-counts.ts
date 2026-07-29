import type { WorkStatusCounts } from "@shared/work";

import type { Database } from "./db";

/** Shared CASE arms for live status and ledger replay — keep these identical. */
export const WORK_STATUS_AGGREGATE_SQL = `
  COALESCE(SUM(CASE WHEN execution IN (
    'preparing', 'running', 'validating', 'awaiting-approval',
    'integrating', 'reporting'
  ) THEN 1 ELSE 0 END), 0) AS working,
  COALESCE(SUM(CASE WHEN execution = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
  COALESCE(SUM(CASE WHEN attention <> 'none' AND resolution IS NULL
    THEN 1 ELSE 0 END), 0) AS needs_attention,
  COALESCE(SUM(CASE WHEN delivery IN ('draft', 'open', 'review')
    AND sync_state = 'current' AND resolution IS NULL
    THEN 1 ELSE 0 END), 0) AS verified_open,
  COALESCE(SUM(CASE WHEN delivery IN ('draft', 'open', 'review')
    AND sync_state IN ('stale', 'error') AND resolution IS NULL
    THEN 1 ELSE 0 END), 0) AS stale_open
`;

export type WorkStateAxisSnapshot = {
  execution: string;
  delivery: string;
  outcome: string;
  attention: string;
  syncState: string;
  resolution: string | null;
  archivedAt: string | null;
};

export function axesChanged(
  before: WorkStateAxisSnapshot | null,
  after: WorkStateAxisSnapshot,
): boolean {
  if (!before) return true;
  return (
    before.execution !== after.execution ||
    before.delivery !== after.delivery ||
    before.outcome !== after.outcome ||
    before.attention !== after.attention ||
    before.syncState !== after.syncState ||
    before.resolution !== after.resolution ||
    before.archivedAt !== after.archivedAt
  );
}

export function axesFromWorkItem(item: {
  execution: string;
  delivery: string;
  outcome: string;
  attention: string;
  syncState: string;
  resolution: string | null;
  archivedAt?: string | null;
}): WorkStateAxisSnapshot {
  return {
    execution: item.execution,
    delivery: item.delivery,
    outcome: item.outcome,
    attention: item.attention,
    syncState: item.syncState,
    resolution: item.resolution,
    archivedAt: item.archivedAt ?? null,
  };
}

export function emptyWorkStatusCounts(): WorkStatusCounts {
  return {
    working: 0,
    queued: 0,
    needsAttention: 0,
    verifiedOpen: 0,
    staleOpen: 0,
  };
}

export function mapStatusCountsRow(row: {
  working: number;
  queued: number;
  needs_attention: number;
  verified_open: number;
  stale_open: number;
} | null | undefined): WorkStatusCounts {
  return {
    working: row?.working ?? 0,
    queued: row?.queued ?? 0,
    needsAttention: row?.needs_attention ?? 0,
    verifiedOpen: row?.verified_open ?? 0,
    staleOpen: row?.stale_open ?? 0,
  };
}

export function sumWorkStatusCounts(parts: WorkStatusCounts[]): WorkStatusCounts {
  return parts.reduce(
    (acc, part) => ({
      working: acc.working + part.working,
      queued: acc.queued + part.queued,
      needsAttention: acc.needsAttention + part.needsAttention,
      verifiedOpen: acc.verifiedOpen + part.verifiedOpen,
      staleOpen: acc.staleOpen + part.staleOpen,
    }),
    emptyWorkStatusCounts(),
  );
}

export type CountWorkStateAtInput = {
  projectId?: string | null;
  kind?: string | null;
  at: string;
};

/**
 * Replay work status counts as of a past instant from work_events state rows.
 * Uses the latest work.state_changed (execution IS NOT NULL) per item at or before `at`.
 */
export function countWorkStateAt(
  db: Database,
  input: CountWorkStateAtInput,
): WorkStatusCounts {
  const sqlite = db.connection();
  const clauses = ["we.execution IS NOT NULL", "we.occurred_at <= ?"];
  const params: string[] = [input.at];

  if (input.projectId) {
    clauses.push("we.project_id = ?");
    params.push(input.projectId);
  }
  if (input.kind) {
    clauses.push(`json_extract(we.data_json, '$.kind') = ?`);
    params.push(input.kind);
  }

  const row = sqlite
    .query<
      {
        working: number;
        queued: number;
        needs_attention: number;
        verified_open: number;
        stale_open: number;
      },
      string[]
    >(
      `SELECT ${WORK_STATUS_AGGREGATE_SQL}
       FROM (
         SELECT we.*, ROW_NUMBER() OVER (
           PARTITION BY we.work_item_id ORDER BY we.sequence DESC
         ) AS rn
         FROM work_events we
         WHERE ${clauses.join(" AND ")}
       ) latest
       WHERE latest.rn = 1 AND latest.archived_at IS NULL`,
    )
    .get(...params);

  return mapStatusCountsRow(row);
}

/**
 * Per-kind replay for rollup materialization. Kind is stored on state events
 * in data_json so counts survive work_item hard-deletes for already-written events.
 */
export function countWorkStateAtByKind(
  db: Database,
  input: { projectId: string; at: string },
): Array<{ kind: string; counts: WorkStatusCounts }> {
  const sqlite = db.connection();
  const rows = sqlite
    .query<
      {
        kind: string;
        working: number;
        queued: number;
        needs_attention: number;
        verified_open: number;
        stale_open: number;
      },
      [string, string]
    >(
      `SELECT
         COALESCE(json_extract(latest.data_json, '$.kind'), 'unknown') AS kind,
         ${WORK_STATUS_AGGREGATE_SQL}
       FROM (
         SELECT we.*, ROW_NUMBER() OVER (
           PARTITION BY we.work_item_id ORDER BY we.sequence DESC
         ) AS rn
         FROM work_events we
         WHERE we.execution IS NOT NULL
           AND we.occurred_at <= ?
           AND we.project_id = ?
       ) latest
       WHERE latest.rn = 1 AND latest.archived_at IS NULL
       GROUP BY COALESCE(json_extract(latest.data_json, '$.kind'), 'unknown')`,
    )
    .all(input.at, input.projectId);

  return rows.map((row) => ({
    kind: row.kind,
    counts: mapStatusCountsRow(row),
  }));
}

/** Truncate an ISO timestamp to the UTC hour boundary. */
export function hourBucketAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp for hour bucket: ${iso}`);
  }
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

/** The hour boundary immediately before the hour containing `iso`. */
export function previousClosedHour(iso: string): string {
  const bucket = new Date(hourBucketAt(iso));
  bucket.setUTCHours(bucket.getUTCHours() - 1);
  return bucket.toISOString();
}
