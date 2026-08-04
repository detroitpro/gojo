import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAppContext } from "@/platform/app-context";
import { WsHub, type WsSocket } from "@/transports/http/ws/hub";
import type { ServerFrame } from "@shared/ws";

class FakeSocket implements WsSocket {
  readonly sent: ServerFrame[] = [];
  backpressure = false;
  data = {};

  send(message: string): number {
    if (this.backpressure) return -1;
    this.sent.push(JSON.parse(message) as ServerFrame);
    return message.length;
  }

  close(): void {}
}

describe("WsHub", () => {
  let tempDir: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;
  let hub: WsHub | null = null;

  afterEach(async () => {
    hub?.close();
    hub = null;
    await ctx?.dispose();
    ctx = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function boot() {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-ws-hub-`);
    ctx = await createAppContext(tempDir);
    hub = new WsHub(ctx);
    return { ctx, hub };
  }

  test("shares one fallback timer across platform subscribers", async () => {
    const { hub: h, ctx: c } = await boot();
    const a = new FakeSocket();
    const b = new FakeSocket();
    h.attach(a);
    h.attach(b);
    expect(h.fallbackActive).toBe(false);

    h.subscribePlatform(a, {
      t: "sub",
      id: 1,
      channel: "platform",
      topics: ["dashboard"],
    });
    expect(h.fallbackActive).toBe(true);
    h.subscribePlatform(b, {
      t: "sub",
      id: 2,
      channel: "platform",
      topics: ["runs"],
    });
    expect(h.fallbackActive).toBe(true);

    c.platformEvents.append({
      type: "instance.paused",
      entityKind: "instance",
      entityId: "instance",
      topics: ["dashboard", "queue"],
    });

    expect(
      a.sent.some(
        (frame) => frame.t === "event" && frame.channel === "platform",
      ),
    ).toBe(true);
    expect(
      b.sent.some(
        (frame) => frame.t === "event" && frame.channel === "platform",
      ),
    ).toBe(false);

    h.unsubscribe(1);
    h.unsubscribe(2);
    expect(h.fallbackActive).toBe(false);
    expect(h.subscriptionCount).toBe(0);
  });

  test("replays platform events after cursor and honors project filter", async () => {
    const { hub: h, ctx: c } = await boot();
    const socket = new FakeSocket();
    h.attach(socket);
    const first = c.platformEvents.append({
      projectId: "p1",
      type: "run.created",
      entityKind: "run",
      entityId: "r1",
      topics: ["runs"],
    });
    const second = c.platformEvents.append({
      projectId: "p1",
      type: "run.state_changed",
      entityKind: "run",
      entityId: "r1",
      topics: ["dashboard"],
    });
    c.platformEvents.append({
      projectId: "p2",
      type: "run.created",
      entityKind: "run",
      entityId: "r2",
      topics: ["dashboard"],
    });

    h.subscribePlatform(socket, {
      t: "sub",
      id: 10,
      channel: "platform",
      projectId: "p1",
      topics: ["dashboard"],
      after: first.sequence,
    });

    const platformEvents = socket.sent.filter(
      (frame): frame is Extract<ServerFrame, { t: "event"; channel: "platform" }> =>
        frame.t === "event" && frame.channel === "platform",
    );
    expect(platformEvents).toHaveLength(1);
    expect(platformEvents[0]!.event.sequence).toBe(second.sequence);
  });

  test("run subscribe returns 404 for missing run", async () => {
    const { hub: h } = await boot();
    const socket = new FakeSocket();
    h.attach(socket);
    const result = h.subscribeRun(socket, {
      t: "sub",
      id: 3,
      channel: "run",
      runId: "missing",
    });
    expect(result).toEqual({ ok: false, error: "Run not found", status: 404 });
  });
});
