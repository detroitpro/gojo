import { describe, expect, test } from "bun:test";

import { GojoSocket } from "../../../web/src/lib/ws-client";
import type { ServerFrame } from "../../../web/src/lib/ws-types";

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: unknown[] = [];

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
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  push(frame: ServerFrame): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
}

describe("GojoSocket", () => {
  test("rejects pending requests on disconnect", async () => {
    let current: FakeWebSocket | null = null;
    const socket = new GojoSocket((url) => {
      current = new FakeWebSocket(url) as unknown as FakeWebSocket;
      return current as unknown as WebSocket;
    });
    socket.connect();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(socket.connected).toBe(true);

    const pending = socket.request("GET", "/api/v1/health");
    socket.disconnect();
    await expect(pending).rejects.toThrow(/disconnected|closed/i);
  });

  test("resumes platform subscription with stored cursor after reconnect", async () => {
    const sockets: FakeWebSocket[] = [];
    const socket = new GojoSocket((url) => {
      const ws = new FakeWebSocket(url);
      sockets.push(ws);
      return ws as unknown as WebSocket;
    });

    const received: number[] = [];
    socket.subscribePlatform(["dashboard"], (event) => received.push(event.sequence));
    await new Promise((resolve) => setTimeout(resolve, 10));

    sockets[0]!.push({
      t: "event",
      sub: 1,
      channel: "platform",
      event: {
        sequence: 5,
        id: "e5",
        projectId: null,
        type: "instance.paused",
        entityKind: "instance",
        entityId: "instance",
        topics: ["dashboard"],
        data: {},
        occurredAt: "2026-07-29T12:00:00.000Z",
        createdAt: "2026-07-29T12:00:00.000Z",
      },
    });
    expect(received).toEqual([5]);

    sockets[0]!.close();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    const subFrames = sockets[1]!.sent.filter(
      (frame) =>
        frame &&
        typeof frame === "object" &&
        (frame as { t?: string }).t === "sub",
    ) as Array<{ after?: number }>;
    expect(subFrames.some((frame) => frame.after === 5)).toBe(true);
    socket.disconnect();
  });
});
