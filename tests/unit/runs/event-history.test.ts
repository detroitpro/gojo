import { describe, expect, test } from "bun:test";

import { RunEventBus, RunEventHistory } from "@/runs/events";

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

  test("clear removes all stored events", () => {
    const history = new RunEventHistory(50);
    history.record({ type: "a", runId: "r1", at: "t1" });
    history.clear();
    expect(history.list("r1")).toEqual([]);
  });

  test("drops oldest non-pinned events when over capacity without output", () => {
    const history = new RunEventHistory(3);
    history.record({ type: "custom.one", runId: "r1", at: "t1" });
    history.record({ type: "run.created", runId: "r1", at: "t2" });
    history.record({ type: "custom.two", runId: "r1", at: "t3" });
    history.record({ type: "custom.three", runId: "r1", at: "t4" });

    const types = history.list("r1").map((event) => event.type);
    expect(types).toEqual(["run.created", "custom.two", "custom.three"]);
  });
});

describe("RunEventBus", () => {
  test("subscribe receives emit and unsubscribe stops delivery", () => {
    const bus = new RunEventBus();
    const received: string[] = [];
    const event = { type: "run.created", runId: "r1", at: "t1" };

    const unsubscribe = bus.subscribe((payload) => {
      received.push(payload.type);
    });
    bus.emit(event);
    unsubscribe();
    bus.emit({ ...event, type: "run.finished" });

    expect(received).toEqual(["run.created"]);
  });
});
