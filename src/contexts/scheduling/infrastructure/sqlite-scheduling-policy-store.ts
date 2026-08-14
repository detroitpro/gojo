import {
  DEFAULT_SCHEDULING_POLICY,
  parseSchedulingPolicy,
  type SchedulingPolicy,
} from "@shared/scheduling";

import type { Database } from "@/infrastructure/persistence";
import {
  getInstanceSetting,
  setInstanceSetting,
} from "@/infrastructure/persistence/instance-settings";

import type { SchedulingPolicyStore } from "../ports/scheduling-policy-store";

const SCHEDULING_POLICY_KEY = "scheduling_policy";

export class SqliteSchedulingPolicyStore implements SchedulingPolicyStore {
  constructor(private readonly db: Database) {}

  get(): SchedulingPolicy {
    const value = getInstanceSetting(this.db, SCHEDULING_POLICY_KEY);
    if (value === undefined) {
      return { ...DEFAULT_SCHEDULING_POLICY };
    }
    try {
      return parseSchedulingPolicy(value);
    } catch {
      return { ...DEFAULT_SCHEDULING_POLICY };
    }
  }

  set(policy: SchedulingPolicy): SchedulingPolicy {
    const parsed = parseSchedulingPolicy(policy);
    setInstanceSetting(this.db, SCHEDULING_POLICY_KEY, parsed);
    return parsed;
  }
}
