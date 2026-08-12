// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { usePlatformEvents } from "@/platform/usePlatformEvents";
import { PlatformEventHub } from "@/infrastructure/platform-events";
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

function Probe({ hub, onEvent }: { hub: PlatformEventHub; onEvent: () => void }) {
  usePlatformEvents({ topics: ["runs"], hub, onEvent });
  return null;
}

describe("usePlatformEvents", () => {
  test("delivers platform events from the hub to subscribers", async () => {
    const sockets: FakeWebSocket[] = [];
    const socket = new GojoSocket((url) => {
      const ws = new FakeWebSocket(url) as unknown as WebSocket;
      sockets.push(ws as unknown as FakeWebSocket);
      return ws;
    });
    const hub = new PlatformEventHub(socket);

    let events = 0;
    render(<Probe hub={hub} onEvent={() => (events += 1)} />);

    await new Promise((resolve) => setTimeout(resolve, 15));

    // The Probe re-renders on state changes (status), which recreates the
    // `topics` / `onEvent` deps of usePlatformEvents' effect and forces a
    // resubscription. Track the id of the *live* subscription (last sub not yet
    // paired with an unsub).
    const sent = sockets[0]!.sent.map(
      (raw) => JSON.parse(raw) as { t: string; id?: number; channel?: string; after?: number },
    );
    const unsubbed = new Set(
      sent.filter((frame) => frame.t === "unsub").map((frame) => frame.id!),
    );
    const liveSub = [...sent]
      .reverse()
      .find(
        (frame) =>
          frame.t === "sub" &&
          frame.channel === "platform" &&
          !unsubbed.has(frame.id!),
      );
    expect(liveSub).toBeDefined();
    const subId = liveSub!.id!;

    sockets[0]!.push({
      t: "event",
      sub: subId,
      channel: "platform",
      event: change(1, { topics: ["runs"] }),
    });
    sockets[0]!.push({
      t: "event",
      sub: subId,
      channel: "platform",
      event: change(2, { topics: ["runs"] }),
    });

    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(events).toBe(2);
    socket.disconnect();
  });
});
