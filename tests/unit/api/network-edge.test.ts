import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppContext } from "@/app/context";
import { createRouter } from "@/api/router";
import { resetRateLimitsForTests } from "@/api/network";
import { startServer } from "@/api/server";
import { UserService } from "@/auth/users";
import { saveInstanceConfig } from "@/config/instance";

describe("api network edge", () => {
  let tempDir: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let apiServer: Awaited<ReturnType<typeof startServer>> | null = null;

  afterEach(async () => {
    resetRateLimitsForTests();
    server?.stop();
    server = null;
    apiServer?.stop();
    apiServer = null;
    await ctx?.dispose();
    ctx = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function bootWithConfig(
    mutate?: (c: Awaited<ReturnType<typeof createAppContext>>) => void,
  ): Promise<{ baseUrl: string; token: string }> {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-network-edge-"));
    ctx = await createAppContext(tempDir);
    mutate?.(ctx);
    ctx.saveInstanceConfig();
    const handler = createRouter(ctx);
    server = Bun.serve({
      port: 0,
      fetch: async (req, bunServer) => (await handler(req, bunServer)) ?? undefined!,
    });
    const baseUrl = server.url.toString().replace(/\/$/, "");
    const csrfOrigin = ctx.instance.publicBaseUrl
      ? new URL(ctx.instance.publicBaseUrl).origin
      : new URL(baseUrl).origin;

    const setup = await fetch(`${baseUrl}/api/v1/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret-pass" }),
    });
    expect(setup.status).toBe(201);

    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret-pass" }),
    });
    expect(login.status).toBe(200);

    const tokenResponse = await fetch(`${baseUrl}/api/v1/auth/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: login.headers.get("Set-Cookie") ?? "",
        Origin: csrfOrigin,
      },
      body: JSON.stringify({ name: "cli" }),
    });
    expect(tokenResponse.status).toBe(201);
    const tokenBody = (await tokenResponse.json()) as { data: { token: string } };
    return { baseUrl, token: tokenBody.data.token };
  }

  test("PATCH network fields returns restartRequired and GET exposes apiBaseUrl", async () => {
    const { baseUrl, token } = await bootWithConfig();
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const patch = await fetch(`${baseUrl}/api/v1/instance`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({
        publicBaseUrl: "https://gojo.example.com",
        trustedProxies: ["cloudflare", "127.0.0.1"],
      }),
    });
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as {
      data: {
        publicBaseUrl: string;
        trustedProxies: string[];
        apiBaseUrl: string;
        restartRequired: boolean;
      };
    };
    expect(body.data.publicBaseUrl).toBe("https://gojo.example.com");
    expect(body.data.trustedProxies).toEqual(["cloudflare", "127.0.0.1"]);
    expect(body.data.apiBaseUrl).toBe("https://gojo.example.com/api/v1");
    expect(body.data.restartRequired).toBe(true);

    const get = await fetch(`${baseUrl}/api/v1/instance`, { headers: auth });
    const getBody = (await get.json()) as { data: { apiBaseUrl: string } };
    expect(getBody.data.apiBaseUrl).toBe("https://gojo.example.com/api/v1");
  });

  test("trusted proxy sets Secure cookie via X-Forwarded-Proto", async () => {
    const { baseUrl } = await bootWithConfig((c) => {
      c.instance.trustedProxies = ["127.0.0.1", "::1"];
      c.instance.cookieSecure = "auto";
    });

    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-For": "203.0.113.50",
      },
      body: JSON.stringify({ username: "admin", password: "secret-pass" }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("Set-Cookie") ?? "";
    expect(setCookie.toLowerCase()).toContain("secure");
  });

  test("ip allowlist blocks non-health routes", async () => {
    const { baseUrl, token } = await bootWithConfig();
    ctx!.instance.ipAllowlist = ["203.0.113.0/24"];

    const health = await fetch(`${baseUrl}/api/v1/health`);
    expect(health.status).toBe(200);

    const projects = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(projects.status).toBe(403);
  });

  test("CSRF rejects cookie mutation from foreign Origin", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-csrf-"));
    ctx = await createAppContext(tempDir);
    ctx.instance.publicBaseUrl = "https://gojo.example.com";
    ctx.saveInstanceConfig();
    const handler = createRouter(ctx);
    server = Bun.serve({
      port: 0,
      fetch: async (req, bunServer) => (await handler(req, bunServer)) ?? undefined!,
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

    const blocked = await fetch(`${baseUrl}/api/v1/instance/pause`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://evil.example",
      },
    });
    expect(blocked.status).toBe(403);
    const blockedBody = (await blocked.json()) as { error: { message: string } };
    expect(blockedBody.error.message).toContain("https://evil.example");
    expect(blockedBody.error.message).toContain("publicBaseUrl");

    const allowed = await fetch(`${baseUrl}/api/v1/instance/pause`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://gojo.example.com",
      },
    });
    expect(allowed.status).toBe(200);
  });

  test("startServer refuses non-loopback without publicBaseUrl", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-start-gate-"));
    ctx = await createAppContext(tempDir);
    const users = new UserService(ctx.db);
    await users.createUser("admin", "secret-pass", "admin");
    ctx.instance.bindHost = "0.0.0.0";
    ctx.instance.publicBaseUrl = null;
    saveInstanceConfig(ctx.instanceConfigPath, ctx.instance);

    await expect(startServer({ ctx, writePid: false })).rejects.toThrow(/publicBaseUrl/i);
  });

  test("doctor warns when https publicBaseUrl lacks trustedProxies", async () => {
    const { baseUrl, token } = await bootWithConfig((c) => {
      c.instance.publicBaseUrl = "https://gojo.example.com";
      c.instance.trustedProxies = [];
    });
    const doctor = await fetch(`${baseUrl}/api/v1/instance/doctor`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(doctor.status).toBe(200);
    const body = (await doctor.json()) as {
      data: {
        network: { publicBaseUrlScheme: string; trustedProxiesConfigured: boolean };
        warnings: string[];
      };
    };
    expect(body.data.network.publicBaseUrlScheme).toBe("https");
    expect(body.data.network.trustedProxiesConfigured).toBe(false);
    expect(body.data.warnings.some((w) => /trustedProxies/i.test(w))).toBe(true);
  });

  test("doctor warns when allowedOrigins omits publicBaseUrl origin", async () => {
    const { baseUrl, token } = await bootWithConfig((c) => {
      c.instance.publicBaseUrl = "https://gojo.example.com";
    });
    ctx!.instance.allowedOrigins = ["https://ui.example.com"];
    ctx!.saveInstanceConfig();

    const doctor = await fetch(`${baseUrl}/api/v1/instance/doctor`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(doctor.status).toBe(200);
    const body = (await doctor.json()) as { data: { warnings: string[] } };
    expect(body.data.warnings.some((w) => /allowedOrigins/i.test(w))).toBe(true);
  });
});
