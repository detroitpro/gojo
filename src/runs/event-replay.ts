import { parseJson } from "@shared/json";
import type { RunEvent, RunEventCursor } from "@shared/ws";

import type { RunEventHistory } from "./events";

export type WorkEventRow = {
  sequence: number;
  type: string;
  occurredAt: string;
  dataJson: string;
};

export interface ReplayRunEventsInput {
  runId: string;
  workItemId: string | null;
  after?: RunEventCursor;
  listDurable: (workItemId: string, afterSequence: number) => WorkEventRow[];
  eventHistory: RunEventHistory;
  parseJson?: (value: string) => unknown;
}

/**
 * Replay durable work_events + in-memory agent output for a run, using
 * namespaced cursors so the two id spaces never collide.
 */
export function replayRunEvents(input: ReplayRunEventsInput): {
  events: RunEvent[];
  cursor: RunEventCursor;
  finished: boolean;
} {
  const after = input.after ?? { durable: 0, live: 0 };
  const parseEventJson = input.parseJson ?? parseJson;
  const events: RunEvent[] = [];
  let durableCursor = after.durable;
  let liveCursor = after.live;
  let finished = false;

  if (input.workItemId) {
    for (const row of input.listDurable(input.workItemId, after.durable)) {
      const event: RunEvent = {
        id: row.sequence,
        idSpace: "durable",
        type: row.type,
        runId: input.runId,
        at: row.occurredAt,
        data: parseEventJson(row.dataJson),
      };
      events.push(event);
      durableCursor = Math.max(durableCursor, row.sequence);
      if (event.type === "run.finished") finished = true;
    }
  }

  for (const event of input.eventHistory
    .list(input.runId, after.live)
    .filter((candidate) => candidate.type === "run.agent.output")) {
    const tagged: RunEvent = {
      ...event,
      idSpace: "live",
    };
    events.push(tagged);
    if (tagged.id != null) liveCursor = Math.max(liveCursor, tagged.id);
  }

  return {
    events,
    cursor: { durable: durableCursor, live: liveCursor },
    finished,
  };
}

/** Tag a live bus event with the live id space for WebSocket delivery. */
export function tagLiveRunEvent(event: RunEvent): RunEvent {
  return event.idSpace ? event : { ...event, idSpace: "live" };
}
