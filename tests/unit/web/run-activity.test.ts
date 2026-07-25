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

  test("pairs started/completed by callId into one tool entry", () => {
    const events: RunEvent[] = [
      evt(
        "run.agent.tool",
        { phase: "started", name: "read", callId: "c1", summary: "foo.ts" },
        "t1",
        1,
      ),
      evt(
        "run.agent.tool",
        { phase: "completed", name: "read", callId: "c1", summary: "foo.ts" },
        "t2",
        2,
      ),
    ];
    const items = buildActivityItems(events);
    const tools = items.filter((i) => i.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]!.tools).toHaveLength(1);
    expect(tools[0]!.tools![0]).toMatchObject({
      callId: "c1",
      name: "read",
      summary: "foo.ts",
      phase: "completed",
    });
    expect(tools[0]!.title).toBe("read · foo.ts");
    expect(tools[0]!.detail).toBeUndefined();
  });

  test("collapses consecutive tools into one group", () => {
    const events: RunEvent[] = [
      evt("run.agent.tool", { phase: "started", name: "read", callId: "a" }, "t1", 1),
      evt("run.agent.tool", { phase: "completed", name: "read", callId: "a" }, "t2", 2),
      evt(
        "run.agent.tool",
        { phase: "started", name: "grep", callId: "b", summary: "TODO" },
        "t3",
        3,
      ),
      evt(
        "run.agent.tool",
        { phase: "completed", name: "grep", callId: "b", summary: "TODO" },
        "t4",
        4,
      ),
      evt("run.agent.tool", { phase: "started", name: "glob", callId: "c" }, "t5", 5),
      evt("run.agent.tool", { phase: "completed", name: "glob", callId: "c" }, "t6", 6),
    ];
    const items = buildActivityItems(events);
    const tools = items.filter((i) => i.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]!.tools).toHaveLength(3);
    expect(tools[0]!.title).toBe("3 tools · read, grep, glob");
    expect(tools[0]!.status).toBe("success");
  });

  test("keeps assistant primacy across tool groups", () => {
    const events: RunEvent[] = [
      evt("run.agent.output", { stream: "stdout", chunk: "Thinking first" }, "t1", 1),
      evt("run.agent.tool", { phase: "started", name: "read", callId: "c1" }, "t2", 2),
      evt("run.agent.tool", { phase: "completed", name: "read", callId: "c1" }, "t3", 3),
      evt("run.agent.output", { stream: "stdout", chunk: "Thinking after" }, "t4", 4),
    ];
    const items = buildActivityItems(events);
    // Newest first: after, tools, before
    expect(items.map((i) => i.kind)).toEqual(["assistant", "tool", "assistant"]);
    expect(items[0]!.body).toBe("Thinking after");
    expect(items[1]!.tools).toHaveLength(1);
    expect(items[2]!.body).toBe("Thinking first");
  });

  test("groups consecutive shells despite interleaved tool-marker stdout", () => {
    const events: RunEvent[] = [
      evt(
        "run.agent.tool",
        { phase: "started", name: "shell", callId: "s1", summary: "cargo check" },
        "t1",
        1,
      ),
      evt(
        "run.agent.output",
        { stream: "stdout", chunk: "\n[tool started] shell · cargo check\n" },
        "t2",
        2,
      ),
      evt(
        "run.agent.tool",
        { phase: "completed", name: "shell", callId: "s1", summary: "cargo check" },
        "t3",
        3,
      ),
      evt(
        "run.agent.output",
        { stream: "stdout", chunk: "\n[tool completed] shell · cargo check\n" },
        "t4",
        4,
      ),
      evt(
        "run.agent.tool",
        { phase: "started", name: "shell", callId: "s2", summary: "cargo test" },
        "t5",
        5,
      ),
      evt(
        "run.agent.output",
        { stream: "stdout", chunk: "\n[tool started] shell · cargo test\n" },
        "t6",
        6,
      ),
      evt(
        "run.agent.tool",
        { phase: "completed", name: "shell", callId: "s2", summary: "cargo test" },
        "t7",
        7,
      ),
      evt(
        "run.agent.output",
        { stream: "stdout", chunk: "\n[tool completed] shell · cargo test\n" },
        "t8",
        8,
      ),
    ];
    const items = buildActivityItems(events);
    const tools = items.filter((i) => i.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]!.tools).toHaveLength(2);
    expect(tools[0]!.title).toBe("2 shells · cargo check, cargo test");
    expect(tools[0]!.status).toBe("success");
  });

  test("real assistant text between shells still splits groups", () => {
    const events: RunEvent[] = [
      evt(
        "run.agent.tool",
        { phase: "started", name: "shell", callId: "s1", summary: "ls" },
        "t1",
        1,
      ),
      evt(
        "run.agent.tool",
        { phase: "completed", name: "shell", callId: "s1", summary: "ls" },
        "t2",
        2,
      ),
      evt("run.agent.output", { stream: "stdout", chunk: "Next I'll run tests" }, "t3", 3),
      evt(
        "run.agent.tool",
        { phase: "started", name: "shell", callId: "s2", summary: "cargo test" },
        "t4",
        4,
      ),
      evt(
        "run.agent.tool",
        { phase: "completed", name: "shell", callId: "s2", summary: "cargo test" },
        "t5",
        5,
      ),
    ];
    const items = buildActivityItems(events);
    expect(items.filter((i) => i.kind === "tool")).toHaveLength(2);
    expect(items.filter((i) => i.kind === "assistant")).toHaveLength(1);
  });
});
