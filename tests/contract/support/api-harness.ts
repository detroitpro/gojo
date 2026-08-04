/**
 * Outside-in API harness for architecture behavior locks.
 * Later refactor phases must keep these contract tests green without editing them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAppContext } from "@/platform/app-context";
import { resetRateLimitsForTests } from "@/transports/http/network";
import { createRouter, type UpgradeServer } from "@/transports/http/router";

export type ApiHarness = {
  baseUrl: string;
  token: string;
  cookie: string;
  home: string;
  ctx: Awaited<ReturnType<typeof createAppContext>>;
  authHeaders: Record<string, string>;
  jsonAuthHeaders: Record<string, string>;
  dispose: () => Promise<void>;
};

export async function bootApiHarness(): Promise<ApiHarness> {
  const home = mkdtempSync(`${tmpdir()}/gojo-contract-api-`);
  const ctx = await createAppContext(home);
  const handler = createRouter(ctx);
  const server = Bun.serve({
    port: 0,
    fetch: async (req, bunServer) =>
      (await handler(req, bunServer as unknown as UpgradeServer)) ?? undefined!,
  });
  const baseUrl = server.url.toString().replace(/\/$/, "");

  const setup = await fetch(`${baseUrl}/api/v1/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "secret-pass" }),
  });
  if (setup.status !== 201) {
    server.stop();
    await ctx.dispose();
    rmSync(home, { recursive: true, force: true });
    throw new Error(`setup failed: ${setup.status}`);
  }

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "secret-pass" }),
  });
  if (login.status !== 200) {
    server.stop();
    await ctx.dispose();
    rmSync(home, { recursive: true, force: true });
    throw new Error(`login failed: ${login.status}`);
  }
  const cookie = login.headers.get("Set-Cookie") ?? "";

  const tokenResponse = await fetch(`${baseUrl}/api/v1/auth/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ name: "contract" }),
  });
  if (tokenResponse.status !== 201) {
    server.stop();
    await ctx.dispose();
    rmSync(home, { recursive: true, force: true });
    throw new Error(`token create failed: ${tokenResponse.status}`);
  }
  const tokenBody = (await tokenResponse.json()) as { data: { token: string } };
  const token = tokenBody.data.token;

  return {
    baseUrl,
    token,
    cookie,
    home,
    ctx,
    authHeaders: { Authorization: `Bearer ${token}` },
    jsonAuthHeaders: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    dispose: async () => {
      resetRateLimitsForTests();
      server.stop();
      await ctx.dispose();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export async function getJson<T>(
  harness: ApiHarness,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${harness.baseUrl}${path}`, init);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

export type ApiErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};

export type ApiSuccessBody<T> = { data: T };
