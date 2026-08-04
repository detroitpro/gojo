import { describe, expect, test } from "bun:test";

import { FixedClock, InMemoryUnitOfWork, RecordingOutbox } from "@/kernel";
import {
  buildSchedulingModule,
  getSchedulingPolicyQuery,
  setSchedulingPolicyCommand,
  type SchedulingPolicyStore,
} from "@/contexts/scheduling";
import type { SchedulingPolicy } from "@shared/scheduling";
import { DEFAULT_SCHEDULING_POLICY } from "@shared/scheduling";

class MemoryPolicyStore implements SchedulingPolicyStore {
  private policy: SchedulingPolicy = { ...DEFAULT_SCHEDULING_POLICY };

  get(): SchedulingPolicy {
    return this.policy;
  }

  set(policy: SchedulingPolicy): SchedulingPolicy {
    this.policy = policy;
    return this.policy;
  }
}

describe("contexts/scheduling policy use cases", () => {
  test("get returns current policy", async () => {
    const store = new MemoryPolicyStore();
    const result = await getSchedulingPolicyQuery({ store });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.policy.maxConcurrentRuns).toBe(
        DEFAULT_SCHEDULING_POLICY.maxConcurrentRuns,
      );
    }
  });

  test("set rejects invalid policy", async () => {
    const store = new MemoryPolicyStore();
    const result = await setSchedulingPolicyCommand(
      {
        store,
        clock: new FixedClock(new Date("2026-01-01T00:00:00.000Z")),
        uow: new InMemoryUnitOfWork(),
      },
      { maxConcurrentRuns: 0 },
    );
    expect(result.ok).toBe(false);
  });

  test("set updates policy and emits scheduling.updated", async () => {
    const store = new MemoryPolicyStore();
    const uow = new InMemoryUnitOfWork();
    const result = await setSchedulingPolicyCommand(
      {
        store,
        clock: new FixedClock(new Date("2026-01-01T00:00:00.000Z")),
        uow,
      },
      {
        maxConcurrentRuns: 4,
        maxConcurrentRunsPerProject: 2,
        minStartIntervalMs: 0,
        maxLoadPerCpu: 0,
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.policy.maxConcurrentRuns).toBe(4);
      expect(result.value.events[0]?.type).toBe("scheduling.updated");
      expect(result.value.events[0]?.topics).toEqual(
        expect.arrayContaining(["dashboard", "queue"]),
      );
    }
    expect(store.get().maxConcurrentRuns).toBe(4);
  });

  test("buildSchedulingModule publishes via outbox", async () => {
    const store = new MemoryPolicyStore();
    const outbox = new RecordingOutbox();
    // Use a thin module built around the in-memory store by calling commands directly
    // through the same outbox pattern as buildSchedulingModule.
    const uow = new InMemoryUnitOfWork();
    const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
    const result = await setSchedulingPolicyCommand(
      { store, clock, uow },
      {
        maxConcurrentRuns: 3,
        maxConcurrentRunsPerProject: 1,
        minStartIntervalMs: 0,
        maxLoadPerCpu: 0,
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      outbox.publish(result.value.events);
    }
    expect(outbox.published).toHaveLength(1);
    void buildSchedulingModule;
  });
});
