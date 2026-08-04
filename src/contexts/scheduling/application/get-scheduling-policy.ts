import type { SchedulingPolicy } from "@shared/scheduling";

import { ok, type Result } from "@/kernel";

import type { SchedulingPolicyStore } from "../ports/scheduling-policy-store";

export type GetSchedulingPolicyDeps = {
  store: SchedulingPolicyStore;
};

export async function getSchedulingPolicyQuery(
  deps: GetSchedulingPolicyDeps,
): Promise<Result<{ policy: SchedulingPolicy }>> {
  return ok({ policy: deps.store.get() });
}
