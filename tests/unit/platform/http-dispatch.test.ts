import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAppContext } from "@/platform/app-context";
import { createRouter } from "@/transports/http/router";
import type { UpgradeServer } from "@/transports/http/router";
import { resetUseCaseRegistryForTests } from "@/platform";

describe("platform/http-dispatch via router", () => {
  let tempDir: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;

  afterEach(async () => {
    resetUseCaseRegistryForTests();
    server?.stop();
    server = null;
    await ctx?.dispose();
    ctx = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function boot(): Promise<{ baseUrl: string; token: string }> {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-http-dispatch-`);
    ctx = await createAppContext(tempDir);
    const handler = createRouter(ctx);
    server = Bun.serve({
      port: 0,
      fetch: async (req, bunServer) =>
        (await handler(req, bunServer as unknown as UpgradeServer)) ?? undefined!,
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
    const cookie = login.headers.get("Set-Cookie") ?? "";
    const tokenRes = await fetch(`${baseUrl}/api/v1/auth/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "t" }),
    });
    const { data } = (await tokenRes.json()) as { data: { token: string } };
    return { baseUrl, token: data.token };
  }

  test("GET/PATCH instance/scheduling go through the registry", async () => {
    const { baseUrl, token } = await boot();
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const get = await fetch(`${baseUrl}/api/v1/instance/scheduling`, { headers: auth });
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as {
      data: { policy: { maxConcurrentRuns: number } };
    };
    expect(getBody.data.policy.maxConcurrentRuns).toBeGreaterThan(0);

    const patch = await fetch(`${baseUrl}/api/v1/instance/scheduling`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({
        maxConcurrentRuns: 5,
        maxConcurrentRunsPerProject: 2,
        minStartIntervalMs: 0,
        maxLoadPerCpu: 0,
      }),
    });
    expect(patch.status).toBe(200);
    const patchBody = (await patch.json()) as {
      data: { policy: { maxConcurrentRuns: number } };
    };
    expect(patchBody.data.policy.maxConcurrentRuns).toBe(5);

    const openapi = await fetch(`${baseUrl}/api/v1/openapi.json`);
    const doc = (await openapi.json()) as {
      data: { paths: Record<string, { get?: { operationId?: string }; patch?: { operationId?: string } }> };
    };
    expect(doc.data.paths["/api/v1/instance/scheduling"]?.get?.operationId).toBe(
      "scheduling.policy.get",
    );
    expect(doc.data.paths["/api/v1/instance/scheduling"]?.patch?.operationId).toBe(
      "scheduling.policy.set",
    );
  });

  test("POST sources/{sourceId}/events dispatches via registry with raw body", async () => {
    const { baseUrl } = await boot();

    const res = await fetch(`${baseUrl}/api/v1/sources/missing-source/events`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Gojo-Signature": "bad" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("Project source not found");

    const openapi = await fetch(`${baseUrl}/api/v1/openapi.json`);
    const doc = (await openapi.json()) as {
      data: { paths: Record<string, { post?: { operationId?: string } }> };
    };
    expect(doc.data.paths["/api/v1/sources/{sourceId}/events"]?.post?.operationId).toBe(
      "work.sources.ingestWebhook",
    );
  });
});
