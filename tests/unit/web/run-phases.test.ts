import { describe, expect, test } from "bun:test";

import { buildPhaseSegments } from "../../../web/src/lib/run-phases";
import type { RunEvent } from "../../../web/src/types";

function evt(
  type: string,
  data?: unknown,
  at = "2026-01-01T00:00:00.000Z",
): RunEvent {
  return {
    type,
    runId: "r1",
    at,
    ...(data !== undefined ? { data } : {}),
  };
}

describe("buildPhaseSegments", () => {
  test("closes Integrate on run.finished without state_changed to Succeeded", () => {
    const events: RunEvent[] = [
      evt("run.state_changed", { from: "Queued", to: "Preparing" }, "2026-01-01T00:00:00.000Z"),
      evt("run.state_changed", { from: "Preparing", to: "Running" }, "2026-01-01T00:00:10.000Z"),
      evt("run.state_changed", { from: "Running", to: "Validating" }, "2026-01-01T00:01:20.000Z"),
      evt("run.state_changed", { from: "Validating", to: "Integrating" }, "2026-01-01T00:01:21.000Z"),
      evt("run.state_changed", { from: "Integrating", to: "Reporting" }, "2026-01-01T00:01:23.000Z"),
      evt("run.finished", { state: "Succeeded" }, "2026-01-01T00:01:24.000Z"),
    ];

    const nowMs = Date.parse("2026-01-01T00:10:00.000Z");
    const segments = buildPhaseSegments(events, nowMs);
    const integrate = segments.find((s) => s.key === "integrate");
    expect(integrate).toBeDefined();
    expect(integrate!.active).toBe(false);
    expect(integrate!.finishedAt).toBe("2026-01-01T00:01:24.000Z");
    // Integrating→Reporting merged; ~3s not ~9 minutes to "now".
    expect(integrate!.durationMs).toBe(3000);
  });

  test("keeps open integrate active while run still reporting", () => {
    const events: RunEvent[] = [
      evt("run.state_changed", { from: "Validating", to: "Integrating" }, "2026-01-01T00:00:00.000Z"),
      evt("run.state_changed", { from: "Integrating", to: "Reporting" }, "2026-01-01T00:00:02.000Z"),
    ];
    const nowMs = Date.parse("2026-01-01T00:00:12.000Z");
    const segments = buildPhaseSegments(events, nowMs);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.active).toBe(true);
    expect(segments[0]!.finishedAt).toBeNull();
    expect(segments[0]!.durationMs).toBe(12_000);
  });

  test("closes on terminal state_changed", () => {
    const events: RunEvent[] = [
      evt("run.state_changed", { from: "Running", to: "Reporting" }, "2026-01-01T00:00:00.000Z"),
      evt("run.state_changed", { from: "Reporting", to: "Succeeded" }, "2026-01-01T00:00:05.000Z"),
      evt("run.finished", { state: "Succeeded" }, "2026-01-01T00:00:05.000Z"),
    ];
    const segments = buildPhaseSegments(events, Date.parse("2026-01-01T01:00:00.000Z"));
    expect(segments[0]!.durationMs).toBe(5000);
    expect(segments[0]!.active).toBe(false);
  });
});
