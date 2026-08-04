import type { Database } from "@/infrastructure/persistence";
import {
  InMemoryUnitOfWork,
  SystemClock,
  type Clock,
  type Outbox,
  type UnitOfWork,
} from "@/kernel";

import { getSchedulingPolicyQuery } from "./application/get-scheduling-policy";
import { setSchedulingPolicyCommand } from "./application/set-scheduling-policy";
import { SqliteSchedulingPolicyStore } from "./infrastructure/sqlite-scheduling-policy-store";

export * from "./contract";

export type SchedulingModule = {
  getPolicy: typeof getSchedulingPolicyQuery extends (
    deps: infer _D,
  ) => infer R
    ? () => R
    : never;
  setPolicy: (input: unknown) => ReturnType<typeof setSchedulingPolicyCommand>;
};

export function buildSchedulingModule(deps: {
  db: Database;
  clock?: Clock;
  outbox?: Outbox;
  uow?: UnitOfWork;
}): {
  getPolicy: () => ReturnType<typeof getSchedulingPolicyQuery>;
  setPolicy: (input: unknown) => ReturnType<typeof setSchedulingPolicyCommand>;
} {
  const store = new SqliteSchedulingPolicyStore(deps.db);
  const clock = deps.clock ?? new SystemClock();
  const uow = deps.uow ?? new InMemoryUnitOfWork();

  return {
    getPolicy: () => getSchedulingPolicyQuery({ store }),
    setPolicy: async (input: unknown) => {
      uow.clearEvents();
      const result = await setSchedulingPolicyCommand({ store, clock, uow }, input);
      if (result.ok && deps.outbox) {
        deps.outbox.publish(result.value.events);
        uow.clearEvents();
      }
      return result;
    },
  };
}
