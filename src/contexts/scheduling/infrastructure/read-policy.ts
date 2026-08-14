import type { SchedulingPolicy } from "@shared/scheduling";

import type { Database } from "@/infrastructure/persistence/db";

import { SqliteSchedulingPolicyStore } from "./sqlite-scheduling-policy-store";

/** Sync read for tick loops that cannot await use-case queries. */
export function readSchedulingPolicy(db: Database): SchedulingPolicy {
  return new SqliteSchedulingPolicyStore(db).get();
}

/** Sync write for tests and tick loops that cannot await use-case commands. */
export function writeSchedulingPolicy(
  db: Database,
  policy: SchedulingPolicy,
): SchedulingPolicy {
  return new SqliteSchedulingPolicyStore(db).set(policy);
}
