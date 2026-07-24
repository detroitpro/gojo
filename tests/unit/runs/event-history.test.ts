import { describe, expect, test } from "bun:test";

import { RunEventHistory } from "@/runs/events";

describe("RunEventHistory", () => {
  test("assigns monotonic ids and prefers dropping output when trimming", () => {
    const history = new RunEventHistory(5);
    history.record({
      type: "run.agent.model",
      runId: "r1",
      at: "2026-01-01T00:00:00.000Z",
      data: { model: "composer" },
    });
    for (let i = 0; i < 10; i += 1) {
      history.record({
        type: "run.agent.output",
        runId: "r1",
        at: `2026-01-01T00:00:0${i}.000Z`,
        data: { stream: "stdout", chunk: `t${i}` },
      });
    }
    history.record({
      type: "run.state_changed",
      runId: "r1",
      at: "2026-01-01T00:01:00.000Z",
      data: { from: "Running", to: "Validating" },
    });

    const list = history.list("r1");
    expect(list.length).toBeLessThanOrEqual(5);
    expect(list.some((e) => e.type === "run.agent.model")).toBe(true);
    expect(list.some((e) => e.type === "run.state_changed")).toBe(true);
    expect(list.every((e) => e.id != null)).toBe(true);
  });

  test("list afterId filters for Last-Event-ID resume", () => {
    const history = new RunEventHistory(50);
    history.record({ type: "a", runId: "r1", at: "t1" });
    history.record({ type: "b", runId: "r1", at: "t2" });
    history.record({ type: "c", runId: "r1", at: "t3" });
    const all = history.list("r1");
    const mid = all[1]!.id!;
    const after = history.list("r1", mid);
    expect(after.map((e) => e.type)).toEqual(["c"]);
  });
});
