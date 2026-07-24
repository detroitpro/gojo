import { Database as SQLiteDatabase } from "bun:sqlite";

import { EXPECTED_TABLES, SCHEMA_DDL, SCHEMA_VERSION } from "./schema";

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
    this.sqlite.exec(SCHEMA_DDL);

    const row = this.sqlite
      .query<{ version: number }, [number]>("SELECT version FROM schema_migrations WHERE version = ?")
      .get(SCHEMA_VERSION);

    if (row === null) {
      const now = new Date().toISOString();
      this.sqlite
        .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(SCHEMA_VERSION, now);
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
