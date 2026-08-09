import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAppContext } from "@/platform/app-context";
import { handleRpcFrame } from "@/transports/http/ws/rpc";
import type { WsConnectionData } from "@/transports/http/ws/types";

describe("handleRpcFrame", () => {
  let tempDir: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;

  afterEach(async () => {
    await ctx?.dispose();
    ctx = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function boot() {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-ws-rpc-`);
    ctx = await createAppContext(tempDir);
    const setup = await (
      await import("@/transports/http/router")
    ).handleApiRequest(
      ctx,
      new Request("http://localhost/api/v1/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret-pass" }),
      }),
    );
    expect(setup?.status).toBe(201);

    const login = await (
      await import("@/transports/http/router")
    ).handleApiRequest(
      ctx,
      new Request("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret-pass" }),
      }),
    );
    expect(login?.status).toBe(200);
    const cookie = login!.headers.get("Set-Cookie") ?? "";
    const data: WsConnectionData = {
      auth: {
        userId: "admin",
        username: "admin",
        authMethod: "session",
      },
      headers: new Headers({ Cookie: cookie.split(";")[0]! }),
      origin: "http://localhost",
      browserOrigin: "http://localhost",
    };
    return data;
  }

  test("maps GET health through the shared dispatcher", async () => {
    const data = await boot();
    const result = await handleRpcFrame(ctx!, data, {
      t: "req",
      id: 7,
      method: "GET",
      path: "/api/v1/health",
    });
    expect(result).toMatchObject({ t: "res", id: 7, ok: true });
    if (result.ok) {
      expect((result.data as { status: string }).status).toBe("ok");
    }
  });

  test("rejects non-api paths", async () => {
    const data = await boot();
    const result = await handleRpcFrame(ctx!, data, {
      t: "req",
      id: 8,
      method: "GET",
      path: "/evil",
    });
    expect(result).toMatchObject({
      t: "res",
      id: 8,
      ok: false,
      status: 400,
    });
  });

  test("propagates HTTP error status", async () => {
    const data = await boot();
    const result = await handleRpcFrame(ctx!, data, {
      t: "req",
      id: 9,
      method: "GET",
      path: "/api/v1/runs/does-not-exist",
    });
    expect(result).toMatchObject({
      t: "res",
      id: 9,
      ok: false,
      status: 404,
    });
  });

  test("normalizes api paths without a leading slash and forwards POST bodies", async () => {
    const data = await boot();
    const health = await handleRpcFrame(ctx!, data, {
      t: "req",
      id: 11,
      method: "GET",
      path: "api/v1/health",
    });
    expect(health).toMatchObject({ t: "res", id: 11, ok: true });

    const login = await handleRpcFrame(ctx!, data, {
      t: "req",
      id: 12,
      method: "POST",
      path: "/api/v1/auth/login",
      body: { username: "admin", password: "secret-pass" },
    });
    expect(login).toMatchObject({ t: "res", id: 12, ok: true });
  });

  test("session RPC mutation passes CSRF when publicBaseUrl is set", async () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-ws-rpc-csrf-`);
    ctx = await createAppContext(tempDir);
    ctx.instance.publicBaseUrl = "https://gojo.example.com";
    ctx.saveInstanceConfig();

    const setup = await (
      await import("@/transports/http/router")
    ).handleApiRequest(
      ctx,
      new Request("http://localhost/api/v1/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret-pass" }),
      }),
    );
    expect(setup?.status).toBe(201);

    const login = await (
      await import("@/transports/http/router")
    ).handleApiRequest(
      ctx,
      new Request("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret-pass" }),
      }),
    );
    expect(login?.status).toBe(200);
    const cookie = login!.headers.get("Set-Cookie") ?? "";
    const data: WsConnectionData = {
      auth: {
        userId: "admin",
        username: "admin",
        authMethod: "session",
      },
      headers: new Headers({ Cookie: cookie.split(";")[0]! }),
      origin: "http://127.0.0.1:7430",
      browserOrigin: "https://gojo.example.com",
    };

    const result = await handleRpcFrame(ctx!, data, {
      t: "req",
      id: 10,
      method: "POST",
      path: "/api/v1/instance/pause",
    });
    expect(result).toMatchObject({ t: "res", id: 10, ok: true });
  });
});
