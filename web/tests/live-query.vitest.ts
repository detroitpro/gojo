// @vitest-environment happy-dom
import { effectScope } from "vue";
import { describe, expect, test } from "vitest";

import { useLiveRefresh } from "@/platform/useLiveQuery";
import {
  PlatformEventHub,
  type PlatformEventConnectionStatus,
} from "@/infrastructure/platform-events";
import { GojoSocket } from "@/infrastructure/ws-client";
import type { PlatformChangeEvent, ServerFrame } from "@gojo/contracts/types";

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
