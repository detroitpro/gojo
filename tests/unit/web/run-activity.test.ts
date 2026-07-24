import { describe, expect, test } from "bun:test";

import { buildActivityItems } from "../../../web/src/lib/run-activity";
import type { RunEvent } from "../../../web/src/types";

function evt(
  type: string,
  data?: unknown,
  at = "2026-01-01T00:00:00.000Z",
  id?: number,
): RunEvent {
  return {
    ...(id != null ? { id } : {}),
    type,
    runId: "r1",
    at,
    ...(data !== undefined ? { data } : {}),
  };
}

describe("buildActivityItems", () => {
  test("coalesces many stdout chunks into one assistant row", () => {
    const events: RunEvent[] = [
      evt("run.agent.model", { model: "composer" }, "t0", 1),
      evt("run.agent.output", { stream: "stdout", chunk: "I'll " }, "t1", 2),
      evt("run.agent.output", { stream: "stdout", chunk: "start" }, "t2", 3),
      evt("run.agent.output", { stream: "stdout", chunk: " measuring" }, "t3", 4),
      evt("run.agent.finished", { exitCode: 0, durationMs: 1000 }, "t4", 5),
    ];
    const items = buildActivityItems(events);
    const assistants = items.filter((i) => i.kind === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]!.body).toBe("I'll start measuring");
    expect(assistants[0]!.title).toContain("I'll");
    // Newest first: finished before assistant chronologically reversed.
    expect(items[0]!.kind).toBe("agent");
  });

  test("tool boundary splits assistant turns", () => {
    const events: RunEvent[] = [
      evt("run.agent.output", { stream: "stdout", chunk: "Before tool" }, "t1", 1),
      evt(
        "run.agent.tool",
        { phase: "started", name: "read", callId: "c1" },
        "t2",
        2,
      ),
      evt("run.agent.output", { stream: "stdout", chunk: "After tool" }, "t3", 3),
    ];
    const items = buildActivityItems(events);
    const assistants = items.filter((i) => i.kind === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants.map((a) => a.body).sort()).toEqual(["After tool", "Before tool"]);
  });

  test("strips duplicate tool marker lines from stdout", () => {
    const events: RunEvent[] = [
      evt(
        "run.agent.output",
        {
          stream: "stdout",
          chunk: "Hello\n[tool started] read (c1)\nWorld",
        },
        "t1",
        1,
      ),
    ];
    const items = buildActivityItems(events);
    expect(items[0]!.body).toBe("Hello\nWorld");
  });
});
