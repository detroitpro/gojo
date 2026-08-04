import {
  getSchedulingPolicy,
  setSchedulingPolicy,
} from "@/infrastructure/persistence/instance-settings";
import type { Database } from "@/infrastructure/persistence";
import type { SchedulingPolicy } from "@shared/scheduling";

import type { SchedulingPolicyStore } from "../ports/scheduling-policy-store";

export class SqliteSchedulingPolicyStore implements SchedulingPolicyStore {
  constructor(private readonly db: Database) {}

  get(): SchedulingPolicy {
    return getSchedulingPolicy(this.db);
  }

  set(policy: SchedulingPolicy): SchedulingPolicy {
    return setSchedulingPolicy(this.db, policy);
  }
}
