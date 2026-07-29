import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAppContext } from "@/app/context";
import { createRouter } from "@/api/router";
import { createWebSocketHandler } from "@/api/ws/handler";
import { WsHub } from "@/api/ws/hub";
import { WS_PATH, type ServerFrame } from "@shared/ws";
import { UserService } from "@/auth/users";

function waitForFrame(
  ws: WebSocket,
  predicate: (frame: ServerFrame) => boolean,
  timeoutMs = 5_000,
): Promise<ServerFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("frame timeout")), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const frame = JSON.parse(String(event.data)) as ServerFrame;
      if (predicate(frame)) {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        resolve(frame);
      }
    };
    ws.addEventListener("message", onMessage);
  });
}

describe("WebSocket flow", () => {
  let tempDir: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let hub: WsHub | null = null;

  afterEach(async () => {
    hub?.close();
    hub = null;
    server?.stop(true);
    server = null;
    await ctx?.dispose();
    ctx = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function boot() {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-ws-flow-`);
    ctx = await createAppContext(tempDir);
    hub = new WsHub(ctx);
    const handler = createRouter(ctx);
    server = Bun.serve({
      port: 0,
      fetch: async (req, bunServer) => (await handler(req, bunServer)) ?? undefined!,
      websocket: createWebSocketHandler(ctx, hub),
    });
    const baseUrl = server.url.toString().replace(/\/$/, "");

    await fetch(`${baseUrl}/api/v1/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret-pass" }),
    });
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret-pass" }),
    });
    const cookie = (login.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    const tokenResponse = await fetch(`${baseUrl}/api/v1/auth/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ name: "cli" }),
    });
    const tokenBody = (await tokenResponse.json()) as { data: { token: string } };
    return { baseUrl, cookie, token: tokenBody.data.token };
  }

  test("rejects unauthenticated and scoped-token upgrades", async () => {
    const { baseUrl, cookie, token } = await boot();
    const unauthorized = await fetch(`${baseUrl}${WS_PATH}`);
    expect(unauthorized.status).toBe(401);

    const users = new UserService(ctx!.db);
    const admin = users.findByUsername("admin");
    expect(admin).toBeTruthy();
    const scoped = users.createApiTokenForUser(admin!.id, "agent", {
      scopes: ["run:progress:run-xyz"],
    });

    const forbidden = await fetch(`${baseUrl}${WS_PATH}`, {
      headers: { Authorization: `Bearer ${scoped.token}` },
    });
    expect(forbidden.status).toBe(403);

    // Sanity: unscoped bearer still works for HTTP.
    const health = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(health.status).toBe(200);
    expect(cookie).toContain("gojo_session=");
  });

  test(
    "RPC round-trip, platform events, and run channel end",
    async () => {
      const { baseUrl, cookie } = await boot();
      const wsUrl = baseUrl.replace(/^http/, "ws") + WS_PATH;
      const ws = new WebSocket(wsUrl, {
        // Bun extension: custom headers on the handshake.
        headers: { Cookie: cookie },
      } as unknown as string[]);

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("ws open failed"));
      });

      const hello = await waitForFrame(ws, (frame) => frame.t === "hello");
      expect(hello).toMatchObject({ t: "hello" });

      ws.send(
        JSON.stringify({
          t: "req",
          id: 1,
          method: "GET",
          path: "/api/v1/health",
        }),
      );
      const healthRes = await waitForFrame(
        ws,
        (frame) => frame.t === "res" && frame.id === 1,
      );
      expect(healthRes).toMatchObject({ t: "res", id: 1, ok: true });

      ws.send(
        JSON.stringify({
          t: "sub",
          id: 2,
          channel: "platform",
          topics: ["dashboard"],
        }),
      );
      await waitForFrame(ws, (frame) => frame.t === "res" && frame.id === 2);

      const appended = ctx!.platformEvents.append({
        type: "instance.paused",
        entityKind: "instance",
        entityId: "instance",
        topics: ["dashboard", "queue"],
      });
      const platformEvent = await waitForFrame(
        ws,
        (frame) =>
          frame.t === "event" &&
          frame.channel === "platform" &&
          frame.event.sequence === appended.sequence,
      );
      expect(platformEvent).toMatchObject({ t: "event", channel: "platform" });

      const project = ctx!.repos.projects.create({
        name: "ws-demo",
        repoPath: tempDir ?? "/tmp/ws-demo",
      });
      const task = ctx!.repos.tasks.create({
        projectId: project.id,
        name: "task",
        prompt: "do work",
      });
      const run = ctx!.repos.runs.create({
        projectId: project.id,
        taskId: task.id,
        idempotencyKey: "ws-run",
        trigger: "manual",
      });

      ws.send(
        JSON.stringify({
          t: "sub",
          id: 3,
          channel: "run",
          runId: run.id,
        }),
      );
      await waitForFrame(ws, (frame) => frame.t === "res" && frame.id === 3);

      ctx!.eventBus.emit({
        type: "run.finished",
        runId: run.id,
        at: new Date().toISOString(),
        data: { state: "Succeeded" },
      });

      const end = await waitForFrame(
        ws,
        (frame) => frame.t === "end" && frame.sub === 3,
      );
      expect(end).toMatchObject({ t: "end", reason: "run_finished" });

      ws.close();
    },
    { timeout: 15_000 },
  );
});
