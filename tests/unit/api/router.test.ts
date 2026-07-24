import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAppContext } from "@/app/context";
import { createRouter } from "@/api/router";
import { UserService } from "@/auth/users";

describe("api/router", () => {
  let tempDir: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;

  afterEach(async () => {
    server?.stop();
    server = null;
    await ctx?.dispose();
    ctx = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function boot(): Promise<{ baseUrl: string; token: string | null }> {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-router-test-`);
    ctx = await createAppContext(tempDir);
    const handler = createRouter(ctx);
    server = Bun.serve({ port: 0, fetch: handler });
    const baseUrl = server.url.toString().replace(/\/$/, "");

    const health = await fetch(`${baseUrl}/api/v1/health`);
    expect(health.status).toBe(200);

    const setupMissingAuth = await fetch(`${baseUrl}/api/v1/projects`, { method: "GET" });
    expect(setupMissingAuth.status).toBe(401);

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
      },
      body: JSON.stringify({ name: "cli" }),
    });
    expect(tokenResponse.status).toBe(201);
    const tokenBody = (await tokenResponse.json()) as { data: { token: string } };

    return { baseUrl, token: tokenBody.data.token };
  }

  test("health and auth protected routes", async () => {
    const { baseUrl, token } = await boot();
    expect(token).toBeTruthy();

    const projects = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(projects.status).toBe(200);

    const localhostMutating = await fetch(`${baseUrl}/api/v1/instance/pause`, {
      method: "POST",
    });
    expect(localhostMutating.status).toBe(401);
  });

  test("setup rejects second admin", async () => {
    const { baseUrl } = await boot();
    const again = await fetch(`${baseUrl}/api/v1/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "other", password: "secret-pass" }),
    });
    expect(again.status).toBe(403);
  });

  test("creates project with bearer token", async () => {
    const { baseUrl, token } = await boot();

    const response = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "demo",
        repoPath: tempDir ?? "/tmp/demo",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { project: { name: string } } };
    expect(body.data.project.name).toBe("demo");
  });

  test("direct user service integrates with context", async () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-router-users-`);
    ctx = await createAppContext(tempDir);
    const users = new UserService(ctx.db);
    expect(users.countUsers()).toBe(0);
    await users.createUser("admin", "pw", "admin");
    expect(users.countUsers()).toBe(1);
  });

  test("tokens list revoke, instance patch, doctor, backups, project delete", async () => {
    const { baseUrl, token } = await boot();
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const listTokens = await fetch(`${baseUrl}/api/v1/auth/tokens`, { headers: auth });
    expect(listTokens.status).toBe(200);
    const tokensBody = (await listTokens.json()) as {
      data: { tokens: Array<{ id: string; name: string }> };
    };
    expect(tokensBody.data.tokens.length).toBeGreaterThanOrEqual(1);
    const tokenId = tokensBody.data.tokens[0]?.id;
    expect(tokenId).toBeTruthy();

    const created = await fetch(`${baseUrl}/api/v1/auth/tokens`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "ephemeral" }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { data: { id: string; token: string } };
    expect(createdBody.data.token.startsWith("gojo_")).toBe(true);

    const revoked = await fetch(`${baseUrl}/api/v1/auth/tokens/${createdBody.data.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(revoked.status).toBe(200);

    const revokeMissing = await fetch(`${baseUrl}/api/v1/auth/tokens/not-a-token`, {
      method: "DELETE",
      headers: auth,
    });
    expect(revokeMissing.status).toBe(404);

    const patch = await fetch(`${baseUrl}/api/v1/instance`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ telemetryEnabled: true }),
    });
    expect(patch.status).toBe(200);
    const patchBody = (await patch.json()) as { data: { telemetryEnabled: boolean } };
    expect(patchBody.data.telemetryEnabled).toBe(true);

    const doctor = await fetch(`${baseUrl}/api/v1/instance/doctor`, { headers: auth });
    expect(doctor.status).toBe(200);
    const doctorBody = (await doctor.json()) as {
      data: { git: boolean; disk: boolean; database: boolean; home: string };
    };
    expect(doctorBody.data.disk).toBe(true);
    expect(doctorBody.data.database).toBe(true);

    const projectResponse = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "to-remove", repoPath: tempDir }),
    });
    expect(projectResponse.status).toBe(201);
    const projectBody = (await projectResponse.json()) as { data: { project: { id: string } } };

    const projectDoctor = await fetch(
      `${baseUrl}/api/v1/projects/${projectBody.data.project.id}/doctor`,
      { headers: auth },
    );
    expect(projectDoctor.status).toBe(200);

    const agentTest = await fetch(`${baseUrl}/api/v1/agents/shell/test`, {
      method: "POST",
      headers: auth,
    });
    expect(agentTest.status).toBe(200);
    const agentBody = (await agentTest.json()) as {
      data: { result: { exitCode: number; stdout: string } };
    };
    expect(agentBody.data.result.exitCode).toBe(0);
    expect(agentBody.data.result.stdout).toContain("gojo-agent-test");

    const backupCreate = await fetch(`${baseUrl}/api/v1/backups`, {
      method: "POST",
      headers: auth,
    });
    expect(backupCreate.status).toBe(201);
    const backupBody = (await backupCreate.json()) as { data: { path: string } };

    const backupList = await fetch(`${baseUrl}/api/v1/backups`, { headers: auth });
    expect(backupList.status).toBe(200);
    const listBody = (await backupList.json()) as {
      data: { backups: Array<{ path: string }> };
    };
    expect(listBody.data.backups.some((item) => item.path === backupBody.data.path)).toBe(true);

    const backupVerify = await fetch(`${baseUrl}/api/v1/backups/verify`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ path: backupBody.data.path }),
    });
    expect(backupVerify.status).toBe(200);
    const verifyBody = (await backupVerify.json()) as { data: { valid: boolean } };
    expect(verifyBody.data.valid).toBe(true);

    const badVerify = await fetch(`${baseUrl}/api/v1/backups/verify`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ path: "/etc/passwd" }),
    });
    expect(badVerify.status).toBe(400);

    const channelsPut = await fetch(`${baseUrl}/api/v1/notification-channels`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ slack: { webhookUrl: "https://example.invalid" } }),
    });
    expect(channelsPut.status).toBe(200);

    const deleted = await fetch(`${baseUrl}/api/v1/projects/${projectBody.data.project.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(deleted.status).toBe(200);
  });
});
