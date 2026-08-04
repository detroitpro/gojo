import { parseJson } from "@shared/json";
import {
  DEFAULT_SCHEDULING_POLICY,
  parseSchedulingPolicy,
  type SchedulingPolicy,
} from "@shared/scheduling";

import type { Database } from "./db";

const SCHEDULING_POLICY_KEY = "scheduling_policy";

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

  return parseJson(row.value_json, undefined);
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

/** @removal(when: only SchedulingPolicyStore uses this): prefer the scheduling port — R15 */
export function getSchedulingPolicy(db: Database): SchedulingPolicy {
  const value = getInstanceSetting(db, SCHEDULING_POLICY_KEY);
  if (value === undefined) {
    return { ...DEFAULT_SCHEDULING_POLICY };
  }
  try {
    return parseSchedulingPolicy(value);
  } catch {
    return { ...DEFAULT_SCHEDULING_POLICY };
  }
}

export function setSchedulingPolicy(db: Database, policy: SchedulingPolicy): SchedulingPolicy {
  const parsed = parseSchedulingPolicy(policy);
  setInstanceSetting(db, SCHEDULING_POLICY_KEY, parsed);
  return parsed;
}
