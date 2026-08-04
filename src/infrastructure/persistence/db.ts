import { Database as SQLiteDatabase } from "bun:sqlite";

import {
  EXPECTED_TABLES,
  SCHEMA_DDL,
  SCHEMA_INDEXES,
  SCHEMA_MIGRATIONS,
  SCHEMA_VERSION,
} from "./schema";

export class Database {
  private readonly sqlite: SQLiteDatabase;

  private constructor(sqlite: SQLiteDatabase) {
    this.sqlite = sqlite;
  }

  static open(path: string): Database {
    const sqlite = new SQLiteDatabase(path);
    sqlite.exec("PRAGMA journal_mode=WAL;");
    sqlite.exec("PRAGMA foreign_keys=ON;");
    return new Database(sqlite);
  }

  migrate(): void {
    // Tables only — indexes that depend on migrated columns run after upgrades.
    this.sqlite.exec(SCHEMA_DDL);

    const current = this.currentSchemaVersion();
    const now = new Date().toISOString();

    if (current === 0) {
      // Fresh DB: SCHEMA_DDL already has latest columns; record current version.
      this.sqlite
        .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(SCHEMA_VERSION, now);
    } else {
      for (const migration of SCHEMA_MIGRATIONS) {
        if (migration.version <= current) {
          continue;
        }
        this.applyMigrationSql(migration.sql);
        this.sqlite
          .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(migration.version, now);
      }
    }

    this.sqlite.exec(SCHEMA_INDEXES);
    this.backfillWorkLedger();
    this.backfillWorkStateEvents();
  }

  private currentSchemaVersion(): number {
    const row = this.sqlite
      .query<{ version: number }, []>(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
      )
      .get();
    return row?.version ?? 0;
  }

  private applyMigrationSql(sql: string): void {
    for (const statement of sql
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)) {
      try {
        this.sqlite.exec(`${statement};`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Idempotent for re-runs / partial upgrades: ADD COLUMN and RENAME
        // COLUMN/TABLE both no-op when the target state is already present.
        if (
          !/duplicate column name/i.test(message) &&
          !/no such column/i.test(message) &&
          !/no such table/i.test(message)
        ) {
          throw error;
        }
      }
    }
  }

  /** Idempotently projects pre-v6 projects, runs, and PR integrations into Work. */
  private backfillWorkLedger(): void {
    this.transaction(() => {
      this.sqlite
        .query(
          `INSERT OR IGNORE INTO project_sources (
            id, project_id, connection_id, kind, external_key, display_name,
            web_url, clone_url, default_branch, metadata_json, sync_state,
            observed_at, next_sync_at, last_error, created_at, updated_at
          )
          SELECT
            'legacy-repository:' || id, id, NULL, 'repository', remote_url, name,
            remote_url, remote_url, default_branch, '{}', 'pending',
            NULL, NULL, NULL, created_at, updated_at
          FROM projects
          WHERE remote_url IS NOT NULL AND trim(remote_url) <> ''
            AND NOT EXISTS (
              SELECT 1 FROM project_sources ps
              WHERE ps.project_id = projects.id AND ps.kind = 'repository'
            )`,
        )
        .run();

      this.sqlite
        .query(
          `INSERT OR IGNORE INTO work_items (
            id, project_id, source_id, kind, native_key, title, summary,
            execution, delivery, outcome, attention, provenance, actor_name,
            profile_id, labels_json, native_state, native_json, web_url,
            observed_at, next_sync_at, sync_state, last_error, created_at,
            updated_at, started_at, completed_at
          )
          SELECT
            'run:' || r.id, r.project_id, NULL, 'run', r.id, a.name, a.description,
            CASE r.state
              WHEN 'Scheduled' THEN 'queued'
              WHEN 'Queued' THEN 'queued'
              WHEN 'Preparing' THEN 'preparing'
              WHEN 'Running' THEN 'running'
              WHEN 'Validating' THEN 'validating'
              WHEN 'AwaitingApproval' THEN 'awaiting-approval'
              WHEN 'Integrating' THEN 'integrating'
              WHEN 'Reporting' THEN 'reporting'
              ELSE 'terminal'
            END,
            'none',
            CASE
              WHEN r.state = 'Succeeded' THEN 'succeeded'
              WHEN r.state IN ('Failed', 'TimedOut', 'InfrastructureFailure', 'Conflict', 'Blocked') THEN 'failed'
              WHEN r.state IN ('Canceled', 'Skipped', 'Superseded', 'Abandoned') THEN 'canceled'
              ELSE 'pending'
            END,
            CASE
              WHEN r.state = 'AwaitingApproval' THEN 'approval'
              WHEN r.state IN ('Blocked', 'Conflict') THEN 'blocked'
              ELSE 'none'
            END,
            'gojo-agent', NULL, a.profile_id, '[]', r.state, '{}', NULL,
            COALESCE(r.finished_at, r.started_at, r.created_at), NULL, 'current',
            r.error_message, r.created_at,
            COALESCE(r.finished_at, r.started_at, r.created_at), r.started_at, r.finished_at
          FROM runs r
          JOIN agents a ON a.id = r.agent_id`,
        )
        .run();

      this.sqlite
        .query(
          `UPDATE runs
           SET work_item_id = 'run:' || id
           WHERE work_item_id IS NULL`,
        )
        .run();

      this.sqlite
        .query(
          `INSERT OR IGNORE INTO run_context (
            run_id, work_item_id, agent_name, agent_description, prompt,
            manifest_hash, instructions, profile_json, adapter, model,
            validation_json, integration_json, failure_policy_json, base_branch,
            schedule_json, created_at
          )
          SELECT
            r.id, r.work_item_id, a.name, a.description, a.prompt,
            NULL, '{}', COALESCE(pr.config_json, '{}'), pr.adapter,
            (SELECT att.model FROM attempts att
              WHERE att.run_id = r.id AND att.model IS NOT NULL
              ORDER BY att.attempt_number DESC LIMIT 1),
            a.validation_profile_json, a.integration_json, a.failure_policy_json,
            p.default_branch,
            CASE WHEN s.id IS NULL THEN NULL ELSE json_object(
              'id', s.id, 'name', s.name, 'cronExpr', s.cron_expr,
              'timezone', s.timezone
            ) END,
            r.created_at
          FROM runs r
          JOIN agents a ON a.id = r.agent_id
          JOIN projects p ON p.id = r.project_id
          LEFT JOIN profiles pr ON pr.id = a.profile_id
          LEFT JOIN schedules s ON s.id = r.schedule_id
          WHERE r.work_item_id IS NOT NULL`,
        )
        .run();

      this.sqlite
        .query(
          `INSERT OR IGNORE INTO work_items (
            id, project_id, source_id, kind, native_key, title, summary,
            execution, delivery, outcome, attention, provenance, actor_name,
            profile_id, labels_json, native_state, native_json, web_url,
            observed_at, next_sync_at, sync_state, last_error, created_at,
            updated_at, started_at, completed_at
          )
          SELECT
            'integration:' || i.id, r.project_id,
            (SELECT ps.id FROM project_sources ps
              WHERE ps.project_id = r.project_id AND ps.kind = 'repository'
              ORDER BY ps.created_at LIMIT 1),
            'pull-request', COALESCE(CAST(i.pr_number AS TEXT), i.pr_url, i.id),
            CASE WHEN i.pr_number IS NOT NULL
              THEN 'Pull request #' || i.pr_number
              ELSE 'Pull request'
            END,
            '', 'none',
            CASE i.status
              WHEN 'open' THEN 'open'
              WHEN 'merged' THEN 'merged'
              WHEN 'closed' THEN 'closed'
              WHEN 'conflict' THEN 'blocked'
              ELSE 'none'
            END,
            CASE
              WHEN i.status = 'merged' THEN 'succeeded'
              WHEN i.status IN ('closed', 'failed', 'conflict') THEN 'failed'
              ELSE 'pending'
            END,
            CASE
              WHEN i.last_error IS NOT NULL THEN 'sync-error'
              WHEN i.status = 'open' AND i.next_check_at IS NULL THEN 'stale'
              ELSE 'none'
            END,
            'gojo-agent', NULL, NULL, '[]', i.status,
            json_object('provider', i.provider, 'repo', i.repo, 'apiUrl', i.api_url),
            i.pr_url, COALESCE(i.last_checked_at, i.updated_at), i.next_check_at,
            CASE
              WHEN i.last_error IS NOT NULL THEN 'error'
              WHEN i.status = 'open' AND i.next_check_at IS NULL THEN 'stale'
              WHEN i.last_checked_at IS NULL THEN 'pending'
              ELSE 'current'
            END,
            i.last_error, i.created_at, i.updated_at, i.opened_at,
            COALESCE(i.merged_at, i.closed_at)
          FROM run_integrations i
          JOIN runs r ON r.id = i.run_id
          WHERE i.pr_url IS NOT NULL OR i.pr_number IS NOT NULL`,
        )
        .run();

      this.sqlite
        .query(
          `INSERT OR IGNORE INTO external_resources (
            id, work_item_id, source_id, native_key, kind, native_state,
            author_name, provenance, labels_json, review_json, checks_json,
            mergeability, web_url, native_json, observed_at, next_sync_at,
            sync_state, last_error, created_at, updated_at
          )
          SELECT
            'integration-resource:' || i.id, 'integration:' || i.id,
            w.source_id, COALESCE(CAST(i.pr_number AS TEXT), i.pr_url, i.id),
            'pull-request', i.status, NULL, 'gojo-agent', '[]', '{}', '{}',
            CASE WHEN i.status = 'conflict' THEN 'conflicting' ELSE NULL END,
            i.pr_url, w.native_json, w.observed_at, w.next_sync_at,
            w.sync_state, w.last_error, i.created_at, i.updated_at
          FROM run_integrations i
          JOIN work_items w ON w.id = 'integration:' || i.id`,
        )
        .run();

      this.sqlite
        .query(
          `INSERT OR IGNORE INTO work_links (
            id, source_work_item_id, target_work_item_id, type, created_at
          )
          SELECT
            'integration-link:' || i.id, 'run:' || i.run_id,
            'integration:' || i.id, 'delivers', i.created_at
          FROM run_integrations i
          WHERE EXISTS (
            SELECT 1 FROM work_items w WHERE w.id = 'integration:' || i.id
          )`,
        )
        .run();
    });

  }

  /**
   * Seed one work.state_changed row per work item that has no state-bearing event yet,
   * stamped at the item's updated_at so upgraded instances start with a coherent baseline.
   */
  private backfillWorkStateEvents(): void {
    this.sqlite
      .query(
        `INSERT INTO work_events (
          id, project_id, work_item_id, run_id, type, data_json, source,
          occurred_at, created_at, execution, delivery, outcome, attention,
          sync_state, resolution, archived_at
        )
        SELECT
          'state-backfill:' || w.id,
          w.project_id,
          w.id,
          NULL,
          'work.state_changed',
          json_object('kind', w.kind),
          'gojo',
          w.updated_at,
          w.updated_at,
          w.execution,
          w.delivery,
          w.outcome,
          w.attention,
          w.sync_state,
          w.resolution,
          w.archived_at
        FROM work_items w
        WHERE NOT EXISTS (
          SELECT 1 FROM work_events e
          WHERE e.work_item_id = w.id AND e.execution IS NOT NULL
        )`,
      )
      .run();
  }

  close(): void {
    this.sqlite.close();
  }

  transaction<T>(fn: () => T): T {
    const run = this.sqlite.transaction(fn);
    return run();
  }

  /** Exposes the underlying SQLite handle for repositories. */
  connection(): SQLiteDatabase {
    return this.sqlite;
  }

  tableNames(): string[] {
    const rows = this.sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    return rows.map((row) => row.name);
  }

  hasExpectedTables(): boolean {
    const names = new Set(this.tableNames());
    return EXPECTED_TABLES.every((table) => names.has(table));
  }
}
