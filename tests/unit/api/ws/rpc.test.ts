import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAppContext } from "@/app/context";
import { handleRpcFrame } from "@/api/ws/rpc";
import type { WsConnectionData } from "@/api/ws/types";

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
      await import("@/api/router")
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
      await import("@/api/router")
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
});
