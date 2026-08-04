import { describe, expect, test } from "bun:test";

import type { RunTrigger } from "@/infrastructure/persistence/types";
import {
  DEFAULT_SCHEDULING_POLICY,
  parseSchedulingPolicy,
  priorityForTrigger,
  safeParseSchedulingPolicy,
} from "@shared/scheduling";

describe("shared/scheduling", () => {
  test("parseSchedulingPolicy applies defaults and safeParse rejects invalid values", () => {
    expect(parseSchedulingPolicy(undefined)).toEqual(DEFAULT_SCHEDULING_POLICY);
    expect(parseSchedulingPolicy({ maxConcurrentRuns: 4 })).toMatchObject({
      maxConcurrentRuns: 4,
      maxConcurrentRunsPerProject: 1,
      minStartIntervalMs: 30_000,
      maxLoadPerCpu: 1.0,
    });

    const invalid = safeParseSchedulingPolicy({ maxConcurrentRuns: 0 });
    expect(invalid.success).toBe(false);
  });

  test("priorityForTrigger maps known triggers and falls back to schedule", () => {
    expect(priorityForTrigger("manual")).toBe(10);
    expect(priorityForTrigger("work")).toBe(15);
    expect(priorityForTrigger("heal")).toBe(20);
    expect(priorityForTrigger("schedule")).toBe(30);
    expect(priorityForTrigger("api" as RunTrigger)).toBe(10);
    expect(priorityForTrigger("unknown" as RunTrigger)).toBe(30);
  });
});
