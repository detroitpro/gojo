import { describe, expect, test } from "bun:test";

import { replayRunEvents } from "@/contexts/execution/infrastructure/event-replay";
import { RunEventHistory } from "@/contexts/execution/infrastructure/events";

describe("replayRunEvents", () => {
  test("keeps durable and live id spaces independent", () => {
    const history = new RunEventHistory();
    // Live history id starts at 1 — same numeric value as a durable sequence.
    history.record({
      type: "run.agent.output",
      runId: "run-1",
      at: "2026-07-29T12:00:01.000Z",
      data: { stream: "stdout", chunk: "hello" },
    });

    const { events, cursor } = replayRunEvents({
      runId: "run-1",
      workItemId: "work-1",
      after: { durable: 0, live: 0 },
      listDurable: () => [
        {
          sequence: 1,
          type: "run.created",
          occurredAt: "2026-07-29T12:00:00.000Z",
          dataJson: JSON.stringify({ state: "Queued" }),
        },
      ],
      eventHistory: history,
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: 1,
      idSpace: "durable",
      type: "run.created",
    });
    expect(events[1]).toMatchObject({
      id: 1,
      idSpace: "live",
      type: "run.agent.output",
    });
    expect(cursor).toEqual({ durable: 1, live: 1 });
  });

  test("marks finished when durable run.finished is present", () => {
    const history = new RunEventHistory();
    const { finished } = replayRunEvents({
      runId: "run-1",
      workItemId: "work-1",
      listDurable: () => [
        {
          sequence: 9,
          type: "run.finished",
          occurredAt: "2026-07-29T12:00:00.000Z",
          dataJson: JSON.stringify({ state: "Succeeded" }),
        },
      ],
      eventHistory: history,
    });
    expect(finished).toBe(true);
  });

  test("respects namespaced after cursor", () => {
    const history = new RunEventHistory();
    history.record({
      id: 1,
      type: "run.agent.output",
      runId: "run-1",
      at: "2026-07-29T12:00:01.000Z",
      data: { stream: "stdout", chunk: "old" },
    });
    history.record({
      id: 2,
      type: "run.agent.output",
      runId: "run-1",
      at: "2026-07-29T12:00:02.000Z",
      data: { stream: "stdout", chunk: "new" },
    });

    const { events } = replayRunEvents({
      runId: "run-1",
      workItemId: "work-1",
      after: { durable: 5, live: 1 },
      listDurable: (_id, after) => {
        expect(after).toBe(5);
        return [];
      },
      eventHistory: history,
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe(2);
  });
});
