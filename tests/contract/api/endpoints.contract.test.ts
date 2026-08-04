/**
 * Behavior lock: HTTP API surface characterization.
 * Do not weaken assertions during architecture refactor phases — keep green by preserving behavior.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  type ApiErrorBody,
  type ApiHarness,
  type ApiSuccessBody,
  bootApiHarness,
  getJson,
} from "../support/api-harness";

describe("contract/api/endpoints", () => {
  let harness: ApiHarness | null = null;

  afterEach(async () => {
    await harness?.dispose();
    harness = null;
  });

  async function boot(): Promise<ApiHarness> {
    harness = await bootApiHarness();
    return harness;
  }

  test("unauthenticated reads return 401 with unauthorized code", async () => {
    const h = await boot();
    const protectedGets = [
      "/api/v1/queue",
      "/api/v1/dashboard",
      "/api/v1/dashboard/overview",
      "/api/v1/impact/items",
      "/api/v1/adapters",
      "/api/v1/filesystem",
      "/api/v1/instance/scheduling",
      "/api/v1/projects",
      "/api/v1/agents",
      "/api/v1/runs",
      "/api/v1/schedules",
      "/api/v1/approvals",
      "/api/v1/integrations",
      "/api/v1/instance",
      "/api/v1/instance/doctor",
      "/api/v1/backups",
      "/api/v1/notification-channels",
      "/api/v1/auth/me",
      "/api/v1/auth/tokens",
    ];
    for (const path of protectedGets) {
      const { status, body } = await getJson<ApiErrorBody>(h, path);
      expect(status, path).toBe(401);
      expect(body.error.code, path).toBe("unauthorized");
    }
  });

  test("GET /api/v1/openapi.json is public and returns OpenAPI document", async () => {
    const h = await boot();
    const response = await fetch(`${h.baseUrl}/api/v1/openapi.json`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        openapi: string;
        info: { title: string };
        paths: Record<string, unknown>;
      };
    };
    expect(body.data.openapi).toMatch(/^3\./);
    expect(body.data.info.title).toBe("Gojo API");
    expect(body.data.paths["/api/v1/health"]).toBeTruthy();
    expect(body.data.paths["/api/v1/dashboard"]).toBeTruthy();
    expect(body.data.paths["/api/v1/adapters"]).toBeTruthy();
  });

  test("POST /api/v1/auth/logout clears session cookie", async () => {
    const h = await boot();
    const response = await fetch(`${h.baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: { Cookie: h.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ApiSuccessBody<{ ok: boolean }>;
    expect(body.data.ok).toBe(true);
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie.toLowerCase()).toContain("max-age=0");
  });

  test("GET /api/v1/queue shape: policy, counts, waiting page, running", async () => {
    const h = await boot();
    const { status, body } = await getJson<
      ApiSuccessBody<{
        policy: { maxConcurrentRuns: number; maxConcurrentRunsPerProject: number };
        counts: { running: number; waiting: number };
        waiting: unknown[];
        running: unknown[];
        total: number;
        limit: number;
        offset: number;
      }>
    >(h, "/api/v1/queue", { headers: h.authHeaders });
    expect(status).toBe(200);
    expect(body.data.policy.maxConcurrentRuns).toBeGreaterThan(0);
    expect(body.data.policy.maxConcurrentRunsPerProject).toBeGreaterThan(0);
    expect(body.data.counts).toEqual({ running: 0, waiting: 0 });
    expect(Array.isArray(body.data.waiting)).toBe(true);
    expect(Array.isArray(body.data.running)).toBe(true);
    expect(body.data.total).toBe(0);
    expect(body.data.limit).toBeGreaterThan(0);
    expect(body.data.offset).toBe(0);
  });

  test("GET /api/v1/dashboard shape and previous null when no run history", async () => {
    const h = await boot();
    const { status, body } = await getJson<
      ApiSuccessBody<{
        projects: number;
        agents: number;
        schedules: number;
        runs: number;
        activeRuns: number;
        runningRuns: number;
        waitingRuns: number;
        schedulingPolicy: { maxConcurrentRuns: number };
        paused: boolean;
        previous: null | Record<string, unknown>;
      }>
    >(h, "/api/v1/dashboard", { headers: h.authHeaders });
    expect(status).toBe(200);
    expect(body.data.projects).toBe(0);
    expect(body.data.agents).toBe(0);
    expect(body.data.schedules).toBe(0);
    expect(body.data.runs).toBe(0);
    expect(body.data.activeRuns).toBe(0);
    expect(body.data.runningRuns).toBe(0);
    expect(body.data.waitingRuns).toBe(0);
    expect(body.data.paused).toBe(false);
    expect(body.data.schedulingPolicy.maxConcurrentRuns).toBeGreaterThan(0);
    expect(body.data.previous).toBeNull();
  });

  test("GET /api/v1/dashboard/overview returns projects array", async () => {
    const h = await boot();
    const { status, body } = await getJson<
      ApiSuccessBody<{ projects: Array<{ id: string; name: string; agents: unknown[] }> }>
    >(h, "/api/v1/dashboard/overview", { headers: h.authHeaders });
    expect(status).toBe(200);
    expect(body.data.projects).toEqual([]);
  });

  test("GET /api/v1/impact/items returns paginated items", async () => {
    const h = await boot();
    const { status, body } = await getJson<
      ApiSuccessBody<{
        items: unknown[];
        total: number;
        limit: number;
        offset: number;
      }>
    >(h, "/api/v1/impact/items", { headers: h.authHeaders });
    expect(status).toBe(200);
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
    expect(body.data.limit).toBeGreaterThan(0);
    expect(body.data.offset).toBe(0);
  });

  test("GET /api/v1/adapters lists detected adapters", async () => {
    const h = await boot();
    const { status, body } = await getJson<
      ApiSuccessBody<{ adapters: Array<{ name: string; installed: boolean }> }>
    >(h, "/api/v1/adapters", { headers: h.authHeaders });
    expect(status).toBe(200);
    expect(body.data.adapters.length).toBeGreaterThan(0);
    const names = body.data.adapters.map((a) => a.name).sort();
    expect(names).toContain("shell");
    for (const adapter of body.data.adapters) {
      expect(typeof adapter.installed).toBe("boolean");
    }
  });

  test("GET /api/v1/filesystem returns listing and roots", async () => {
    const h = await boot();
    const { status, body } = await getJson<
      ApiSuccessBody<{
        listing: { path: string; entries: unknown[] };
        roots: unknown[];
      }>
    >(h, "/api/v1/filesystem", { headers: h.authHeaders });
    expect(status).toBe(200);
    expect(typeof body.data.listing.path).toBe("string");
    expect(Array.isArray(body.data.listing.entries)).toBe(true);
    expect(Array.isArray(body.data.roots)).toBe(true);
    expect(body.data.roots.length).toBeGreaterThan(0);
  });

  test("GET /api/v1/filesystem rejects path outside roots", async () => {
    const h = await boot();
    const { status, body } = await getJson<ApiErrorBody>(
      h,
      `/api/v1/filesystem?path=${encodeURIComponent("/nonexistent-gojo-root-xyz")}`,
      { headers: h.authHeaders },
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe("validation_error");
  });

  test("GET/PATCH /api/v1/instance/scheduling round-trip", async () => {
    const h = await boot();
    const get = await getJson<
      ApiSuccessBody<{
        policy: {
          maxConcurrentRuns: number;
          maxConcurrentRunsPerProject: number;
          minStartIntervalMs: number;
          maxLoadPerCpu: number;
        };
      }>
    >(h, "/api/v1/instance/scheduling", { headers: h.authHeaders });
    expect(get.status).toBe(200);
    const original = get.body.data.policy;

    const bad = await getJson<ApiErrorBody>(h, "/api/v1/instance/scheduling", {
      method: "PATCH",
      headers: h.jsonAuthHeaders,
      body: JSON.stringify({ maxConcurrentRuns: 0 }),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("validation_error");

    const patched = await getJson<
      ApiSuccessBody<{
        policy: { maxConcurrentRuns: number; maxConcurrentRunsPerProject: number };
      }>
    >(h, "/api/v1/instance/scheduling", {
      method: "PATCH",
      headers: h.jsonAuthHeaders,
      body: JSON.stringify({
        maxConcurrentRuns: original.maxConcurrentRuns,
        maxConcurrentRunsPerProject: original.maxConcurrentRunsPerProject,
        minStartIntervalMs: original.minStartIntervalMs,
        maxLoadPerCpu: original.maxLoadPerCpu,
      }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.policy.maxConcurrentRuns).toBe(original.maxConcurrentRuns);
  });

  test("POST /api/v1/instance/resume after pause", async () => {
    const h = await boot();
    const pause = await getJson<ApiSuccessBody<{ paused: boolean }>>(
      h,
      "/api/v1/instance/pause",
      { method: "POST", headers: h.authHeaders },
    );
    expect(pause.status).toBe(200);
    expect(pause.body.data.paused).toBe(true);
    expect(h.ctx.isPaused()).toBe(true);

    const resume = await getJson<ApiSuccessBody<{ paused: boolean }>>(
      h,
      "/api/v1/instance/resume",
      { method: "POST", headers: h.authHeaders },
    );
    expect(resume.status).toBe(200);
    expect(resume.body.data.paused).toBe(false);
    expect(h.ctx.isPaused()).toBe(false);
  });

  test("POST /api/v1/control/intents validates required fields", async () => {
    const h = await boot();
    const unauth = await getJson<ApiErrorBody>(h, "/api/v1/control/intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(unauth.status).toBe(401);

    const missing = await getJson<ApiErrorBody>(h, "/api/v1/control/intents", {
      method: "POST",
      headers: h.jsonAuthHeaders,
      body: JSON.stringify({ projectId: "x" }),
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("validation_error");
    expect(missing.body.error.message).toContain("projectId");
  });

  test("catalog of authenticated GET endpoints returns success envelopes", async () => {
    const h = await boot();
    const paths = [
      "/api/v1/health",
      "/api/v1/auth/me",
      "/api/v1/auth/tokens",
      "/api/v1/projects",
      "/api/v1/agents",
      "/api/v1/schedules",
      "/api/v1/schedules/upcoming",
      "/api/v1/runs",
      "/api/v1/queue",
      "/api/v1/approvals",
      "/api/v1/integrations?status=open",
      "/api/v1/impact/items",
      "/api/v1/dashboard",
      "/api/v1/dashboard/overview",
      "/api/v1/dashboard/impact",
      "/api/v1/instance",
      "/api/v1/instance/scheduling",
      "/api/v1/instance/doctor",
      "/api/v1/backups",
      "/api/v1/notification-channels",
      "/api/v1/adapters",
      "/api/v1/filesystem",
    ];
    for (const path of paths) {
      const init: RequestInit =
        path === "/api/v1/health" ? {} : { headers: h.authHeaders };
      const { status, body } = await getJson<{ data?: unknown; error?: unknown }>(h, path, init);
      expect(status, path).toBe(200);
      expect(body.data, path).toBeDefined();
      expect(body.error, path).toBeUndefined();
    }
  });
});
