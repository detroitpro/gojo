import type { Database } from "@/infrastructure/persistence/db";
import type { SchedulingPolicy } from "@shared/scheduling";

import { SqliteSchedulingPolicyStore } from "./sqlite-scheduling-policy-store";

/** Sync read for tick loops that cannot await use-case queries. */
export function readSchedulingPolicy(db: Database): SchedulingPolicy {
  return new SqliteSchedulingPolicyStore(db).get();
}
