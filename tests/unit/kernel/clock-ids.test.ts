import { describe, expect, test } from "bun:test";

import { FixedClock, SystemClock } from "@/kernel/clock";
import { SequenceIdGenerator, UlidGenerator, isValidUlid } from "@/kernel/ids";

describe("kernel/clock", () => {
  test("FixedClock is deterministic and advances", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));
    expect(clock.nowIso()).toBe("2026-01-01T00:00:00.000Z");
    clock.advance(1_000);
    expect(clock.nowMs()).toBe(Date.parse("2026-01-01T00:00:01.000Z"));
  });

  test("SystemClock returns a Date", () => {
    const clock = new SystemClock();
    expect(clock.now()).toBeInstanceOf(Date);
    expect(clock.nowMs()).toBeGreaterThan(0);
  });
});

describe("kernel/ids", () => {
  test("UlidGenerator produces valid ULIDs", () => {
    const id = new UlidGenerator().next();
    expect(isValidUlid(id)).toBe(true);
  });

  test("SequenceIdGenerator is deterministic", () => {
    const ids = new SequenceIdGenerator("01TEST");
    expect(ids.next()).toBe(`01TEST${"1".padStart(21, "0")}`);
    expect(ids.next()).toBe(`01TEST${"2".padStart(21, "0")}`);
  });
});
