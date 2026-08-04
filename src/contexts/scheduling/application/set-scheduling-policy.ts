import {
  safeParseSchedulingPolicy,
  type SchedulingPolicy,
} from "@shared/scheduling";

import {
  domainEvent,
  err,
  ok,
  type Clock,
  type DomainEvent,
  type Result,
  type UnitOfWork,
} from "@/kernel";

import type { SchedulingPolicyStore } from "../ports/scheduling-policy-store";

export type SetSchedulingPolicyDeps = {
  store: SchedulingPolicyStore;
  clock: Clock;
  uow: UnitOfWork;
};

export async function setSchedulingPolicyCommand(
  deps: SetSchedulingPolicyDeps,
  input: unknown,
): Promise<Result<{ policy: SchedulingPolicy; events: readonly DomainEvent[] }>> {
  const parsed = safeParseSchedulingPolicy(input);
  if (!parsed.success) {
    return err(parsed.error.message);
  }

  const policy = deps.store.set(parsed.data);
  const event = domainEvent(
    {
      type: "scheduling.updated",
      entityKind: "instance",
      entityId: "scheduling",
      topics: ["dashboard", "overview", "queue"],
      data: policy as unknown as Record<string, unknown>,
    },
    deps.clock.nowIso(),
  );
  deps.uow.addEvent(event);
  return ok({ policy, events: deps.uow.events() });
}
