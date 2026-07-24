import { describe, expect, test } from "bun:test";

import { missedOccurrences, nextOccurrence, nextOccurrences } from "@/scheduler/cron";

describe("scheduler/cron", () => {
  test("nextOccurrences returns upcoming runs in UTC", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const runs = nextOccurrences("0 * * * *", "UTC", from, 3);

    expect(runs).toHaveLength(3);
    expect(runs[0]?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
    expect(runs[1]?.toISOString()).toBe("2026-01-01T02:00:00.000Z");
    expect(runs[2]?.toISOString()).toBe("2026-01-01T03:00:00.000Z");
  });

  test("nextOccurrences respects timezone for local wall-clock times", () => {
    const from = new Date("2026-01-15T12:00:00.000Z");
    const utcRuns = nextOccurrences("0 9 * * *", "UTC", from, 1);
    const easternRuns = nextOccurrences("0 9 * * *", "America/New_York", from, 1);

    expect(utcRuns[0]?.toISOString()).toBe("2026-01-16T09:00:00.000Z");
    expect(easternRuns[0]?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
    expect(easternRuns[0]?.toISOString()).not.toBe(utcRuns[0]?.toISOString());
  });

  test("nextOccurrences handles DST spring-forward gap", () => {
    const from = new Date("2026-03-08T06:00:00.000Z");
    const runs = nextOccurrences("0 2 * * *", "America/New_York", from, 1);

    expect(runs[0]?.toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });

  test("missedOccurrences collects runs between anchor and until", () => {
    const after = new Date("2026-01-01T00:00:00.000Z");
    const until = new Date("2026-01-01T03:30:00.000Z");
    const missed = missedOccurrences("0 * * * *", "UTC", after, until);

    expect(missed.map((d) => d.toISOString())).toEqual([
      "2026-01-01T01:00:00.000Z",
      "2026-01-01T02:00:00.000Z",
      "2026-01-01T03:00:00.000Z",
    ]);
  });

  test("nextOccurrence returns null for empty count", () => {
    expect(nextOccurrences("0 * * * *", "UTC", new Date(), 0)).toEqual([]);
    expect(nextOccurrence("0 * * * *", "UTC", new Date("2026-01-01T00:00:00.000Z"))).not.toBeNull();
  });
});
