import { describe, expect, test } from "bun:test";
import { effectScope } from "../../../web/node_modules/vue";

import { useLiveRefresh } from "../../../web/src/composables/useLiveQuery";
import {
  PlatformEventHub,
  type PlatformEventConnectionStatus,
} from "../../../web/src/lib/platform-events";
import { GojoSocket } from "../../../web/src/lib/ws-client";
import type { PlatformChangeEvent, ServerFrame } from "../../../web/src/lib/ws-types";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];

  constructor(public readonly url: string) {
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event("open"));
      this.push({
        t: "hello",
        user: { id: "u1", username: "admin" },
        version: "0.1.0",
      });
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  push(frame: ServerFrame): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
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
  test("shares one connection and routes deduplicated topic/project events", async () => {
    const sockets: FakeWebSocket[] = [];
    const socket = new GojoSocket((url) => {
      const ws = new FakeWebSocket(url) as unknown as WebSocket;
      sockets.push(ws as unknown as FakeWebSocket);
      return ws;
    });
    const hub = new PlatformEventHub(socket);
    const received: number[] = [];
    const statuses: PlatformEventConnectionStatus[] = [];
    const stopStatus = hub.subscribeStatus((status) => statuses.push(status));
    const unsubscribe = hub.subscribe(
      ["dashboard"],
      (event) => received.push(event.sequence),
      "project-1",
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toContain("/api/v1/ws");
    expect(statuses).toContain("connected");

    sockets[0]!.push({
      t: "event",
      sub: 1,
      channel: "platform",
      event: change(1),
    });
    sockets[0]!.push({
      t: "event",
      sub: 1,
      channel: "platform",
      event: change(1),
    });
    sockets[0]!.push({
      t: "event",
      sub: 1,
      channel: "platform",
      event: change(2, { projectId: "project-2" }),
    });
    sockets[0]!.push({
      t: "event",
      sub: 1,
      channel: "platform",
      event: change(3, { topics: ["tasks"] }),
    });

    expect(received).toEqual([1]);
    unsubscribe();
    stopStatus();
    socket.disconnect();
    expect(hub.status).toBe("idle");
  });
});

describe("useLiveRefresh", () => {
  test("coalesces event bursts into one refresh", async () => {
    const sockets: FakeWebSocket[] = [];
    const socket = new GojoSocket((url) => {
      const ws = new FakeWebSocket(url) as unknown as WebSocket;
      sockets.push(ws as unknown as FakeWebSocket);
      return ws;
    });
    const hub = new PlatformEventHub(socket);
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
    await new Promise((resolve) => setTimeout(resolve, 15));
    sockets[0]!.push({
      t: "event",
      sub: 1,
      channel: "platform",
      event: change(1, { topics: ["runs"] }),
    });
    sockets[0]!.push({
      t: "event",
      sub: 1,
      channel: "platform",
      event: change(2, { topics: ["runs"] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(refreshes).toBe(2);
    scope.stop();
    socket.disconnect();
  });
});
