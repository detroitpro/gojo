import { describe, expect, test } from "bun:test";
import { effectScope } from "../../../web/node_modules/vue";

import { useLiveRefresh } from "../../../web/src/composables/useLiveQuery";
import {
  PlatformEventHub,
  type PlatformEventConnectionStatus,
} from "../../../web/src/lib/platform-events";
import type { PlatformChangeEvent } from "../../../web/src/types";

class FakeEventSource {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  message(event: PlatformChangeEvent): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  }
}

function change(
  sequence: number,
  overrides: Partial<PlatformChangeEvent> = {},
): PlatformChangeEvent {
  return {
    sequence,
    id: `event-${sequence}`,
    projectId: "project-1",
    type: "run.state_changed",
    entityKind: "run",
    entityId: "run-1",
    topics: ["dashboard", "runs"],
    data: {},
    occurredAt: "2026-07-27T19:00:00.000Z",
    createdAt: "2026-07-27T19:00:00.000Z",
    ...overrides,
  };
}

describe("PlatformEventHub", () => {
  test("shares one connection and routes deduplicated topic/project events", () => {
    const sources: FakeEventSource[] = [];
    const urls: string[] = [];
    const hub = new PlatformEventHub((url) => {
      urls.push(url);
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    });
    const received: number[] = [];
    const statuses: PlatformEventConnectionStatus[] = [];
    const stopStatus = hub.subscribeStatus((status) => statuses.push(status));
    const unsubscribe = hub.subscribe(
      ["dashboard"],
      (event) => received.push(event.sequence),
      "project-1",
    );

    expect(urls).toEqual(["/api/v1/events?after=0"]);
    sources[0]!.open();
    sources[0]!.message(change(1));
    sources[0]!.message(change(1));
    sources[0]!.message(change(2, { projectId: "project-2" }));
    sources[0]!.message(change(3, { topics: ["tasks"] }));

    expect(received).toEqual([1]);
    expect(statuses).toContain("connected");
    unsubscribe();
    stopStatus();
    expect(sources[0]!.closed).toBe(true);
    expect(hub.status).toBe("idle");
  });
});

describe("useLiveRefresh", () => {
  test("coalesces event bursts into one refresh", async () => {
    const sources: FakeEventSource[] = [];
    const hub = new PlatformEventHub(() => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    });
    const scope = effectScope();
    let refreshes = 0;
    scope.run(() => {
      useLiveRefresh({
        topics: ["runs"],
        hub,
        coalesceMs: 10,
        refresh: () => {
          refreshes += 1;
        },
      });
    });
    await Promise.resolve();
    sources[0]!.open();
    sources[0]!.message(change(1));
    sources[0]!.message(change(2));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(refreshes).toBe(2);
    scope.stop();
    expect(sources[0]!.closed).toBe(true);
  });
});
