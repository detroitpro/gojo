import { describe, expect, test } from "bun:test";

import { selectMissedRuns, shouldStartGivenOverlap } from "@/scheduler/policies";

describe("scheduler/policies", () => {
  describe("shouldStartGivenOverlap", () => {
    test("starts when no active run", () => {
      expect(shouldStartGivenOverlap("skip", false, 0)).toBe("start");
      expect(shouldStartGivenOverlap("queue", false, 0)).toBe("start");
    });

    test("skip policy skips overlapping runs", () => {
      expect(shouldStartGivenOverlap("skip", true, 0)).toBe("skip");
    });

    test("queue policy queues first overlap and coalesces additional", () => {
      expect(shouldStartGivenOverlap("queue", true, 0)).toBe("queue");
      expect(shouldStartGivenOverlap("queue", true, 1)).toBe("skip");
    });

    test("cancel_replace replaces active run", () => {
      expect(shouldStartGivenOverlap("cancel_replace", true, 0)).toBe("cancel_replace");
    });

    test("allow_parallel always starts", () => {
      expect(shouldStartGivenOverlap("allow_parallel", true, 2)).toBe("start");
    });
  });

  describe("selectMissedRuns", () => {
    const missed = [
      new Date("2026-01-01T01:00:00.000Z"),
      new Date("2026-01-01T02:00:00.000Z"),
      new Date("2026-01-01T03:00:00.000Z"),
    ];

    test("skip returns empty", () => {
      expect(selectMissedRuns("skip", missed)).toEqual([]);
    });

    test("run_once returns earliest missed", () => {
      expect(selectMissedRuns("run_once", missed)).toEqual([missed[0]!]);
    });

    test("run_all returns all missed", () => {
      expect(selectMissedRuns("run_all", missed)).toEqual(missed);
    });

    test("run_latest returns most recent missed", () => {
      expect(selectMissedRuns("run_latest", missed)).toEqual([missed[2]!]);
    });
  });
});
