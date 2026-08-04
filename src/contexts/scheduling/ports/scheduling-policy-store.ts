import type { SchedulingPolicy } from "@shared/scheduling";

export interface SchedulingPolicyStore {
  get(): SchedulingPolicy;
  set(policy: SchedulingPolicy): SchedulingPolicy;
}
