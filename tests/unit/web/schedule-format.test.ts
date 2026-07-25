import { describe, expect, test } from "bun:test";

import { formatRelativeNextRun } from "../../../web/src/lib/schedule-format";

describe("formatRelativeNextRun", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");

  test("null and invalid", () => {
    expect(formatRelativeNextRun(null, now)).toBe("—");
    expect(formatRelativeNextRun("nope", now)).toBe("—");
  });

  test("minutes and hours", () => {
    expect(formatRelativeNextRun("2026-01-01T12:00:30.000Z", now)).toBe("in under a minute");
    expect(formatRelativeNextRun("2026-01-01T12:05:00.000Z", now)).toBe("in 5 minutes");
    expect(formatRelativeNextRun("2026-01-01T13:00:00.000Z", now)).toBe("in 1 hour");
    expect(formatRelativeNextRun("2026-01-01T18:00:00.000Z", now)).toBe("in 6 hours");
  });

  test("tonight and tomorrow in UTC", () => {
    // Same calendar day later evening
    expect(formatRelativeNextRun("2026-01-01T23:00:00.000Z", now, "UTC")).toBe(
      "tonight 11:00 PM",
    );
    expect(formatRelativeNextRun("2026-01-02T09:00:00.000Z", now, "UTC")).toBe(
      "tomorrow 9:00 AM",
    );
  });

  test("past is now", () => {
    expect(formatRelativeNextRun("2026-01-01T11:00:00.000Z", now)).toBe("now");
  });
});
