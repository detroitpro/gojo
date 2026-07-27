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
        // Idempotent for re-runs / partial upgrades.
        if (!/duplicate column name/i.test(message)) {
          throw error;
        }
      }
    }
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
