import type { Database } from "@/storage/db";

function nowIso(): string {
  return new Date().toISOString();
}

export function getInstanceSetting(db: Database, key: string): unknown {
  const row = db
    .connection()
    .query<{ value_json: string }, [string]>("SELECT value_json FROM instance_settings WHERE key = ?")
    .get(key);

  if (!row) {
    return undefined;
  }

  try {
    return JSON.parse(row.value_json) as unknown;
  } catch {
    return undefined;
  }
}

export function setInstanceSetting(db: Database, key: string, value: unknown): void {
  const sqlite = db.connection();
  const now = nowIso();
  const valueJson = JSON.stringify(value);
  const existing = sqlite
    .query<{ key: string }, [string]>("SELECT key FROM instance_settings WHERE key = ?")
    .get(key);

  if (existing) {
    sqlite
      .query("UPDATE instance_settings SET value_json = ?, updated_at = ? WHERE key = ?")
      .run(valueJson, now, key);
  } else {
    sqlite
      .query("INSERT INTO instance_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
      .run(key, valueJson, now);
  }
}

export function isInstancePaused(db: Database): boolean {
  const value = getInstanceSetting(db, "paused");
  return value === true;
}

export function setInstancePaused(db: Database, paused: boolean): void {
  setInstanceSetting(db, "paused", paused);
}
