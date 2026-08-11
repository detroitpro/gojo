import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAppContext } from "@/platform/app-context";
import { resetRateLimitsForTests } from "@/transports/http/network";
import { createRouter } from "@/transports/http/router";
import { UserService } from "@/contexts/access/infrastructure/auth/users";

describe("api/router", () => {
  let tempDir: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;

  afterEach(async () => {
    resetRateLimitsForTests();
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
    server = Bun.serve({
      port: 0,
      fetch: async (req, bunServer) => (await handler(req, bunServer)) ?? undefined!,
    });
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

  test("auth me and password change", async () => {
    const { baseUrl, token } = await boot();
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: auth });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { data: { user: { username: string } } };
    expect(meBody.data.user.username).toBe("admin");

    const unauth = await fetch(`${baseUrl}/api/v1/auth/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "secret-pass", newPassword: "new-secret-99" }),
    });
    expect(unauth.status).toBe(401);

    const wrong = await fetch(`${baseUrl}/api/v1/auth/password`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "new-secret-99" }),
    });
    expect(wrong.status).toBe(401);

    const ok = await fetch(`${baseUrl}/api/v1/auth/password`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ currentPassword: "secret-pass", newPassword: "new-secret-99" }),
    });
    expect(ok.status).toBe(200);

    // Bearer API tokens remain valid after password change.
    const meAfter = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: auth });
    expect(meAfter.status).toBe(200);

    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "new-secret-99" }),
    });
    expect(login.status).toBe(200);
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
    expect(
      ctx!.platformEvents
        .list({ afterSequence: 0, topics: ["projects"] })
        .some((event) => event.type === "project.created"),
    ).toBe(true);
  });

  test("rejects unauthenticated WebSocket upgrade", async () => {
    const { baseUrl } = await boot();
    const unauthorized = await fetch(`${baseUrl}/api/v1/ws`);
    expect(unauthorized.status).toBe(401);
  });

  test("serves unified work, status, sources, detail, and run progress", async () => {
    const { baseUrl, token } = await boot();
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const project = ctx!.repos.projects.create({
      name: "visibility",
      repoPath: tempDir ?? "/tmp/visibility",
    });
    const task = ctx!.repos.agents.create({
      projectId: project.id,
      name: "maintain-work",
      description: "Maintain the work ledger",
      prompt: "report",
    });
    const run = await ctx!.coordinator.createRun({
      projectId: project.id,
      agentId: task.id,
      trigger: "manual",
    });
    const connection = ctx!.work.connections.create({
      name: "external",
      adapter: "generic-webhook",
      capabilities: {
        read: false,
        list: false,
        webhooks: true,
        write: false,
        workKinds: ["ticket"],
      },
    });
    const source = ctx!.work.sources.create({
      projectId: project.id,
      connectionId: connection.id,
      kind: "tracker",
      externalKey: "ops",
      displayName: "Operations",
    });
    const ticket = ctx!.work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "ticket",
      nativeKey: "OPS-7",
      title: "Investigate queue",
      delivery: "open",
      provenance: "human",
      nativeState: "triage",
      observedAt: "2026-07-27T17:00:00.000Z",
      syncState: "current",
    });

    const page = await fetch(
      `${baseUrl}/api/v1/projects/${project.id}/work?kind=ticket&limit=10`,
      { headers: auth },
    );
    expect(page.status).toBe(200);
    const pageBody = (await page.json()) as {
      data: { items: Array<{ id: string; nativeKey: string }>; total: number };
    };
    expect(pageBody.data.total).toBe(1);
    expect(pageBody.data.items[0]?.nativeKey).toBe("OPS-7");

    const status = await fetch(
      `${baseUrl}/api/v1/projects/${project.id}/work/status`,
      { headers: auth },
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      data: { verifiedOpen: 1 },
    });

    const detail = await fetch(`${baseUrl}/api/v1/work/${ticket.id}`, {
      headers: auth,
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      data: {
        work: { nativeKey: "OPS-7" },
        links: [],
        events: expect.arrayContaining([
          expect.objectContaining({ type: "work.state_changed" }),
        ]),
      },
    });

    const sources = await fetch(`${baseUrl}/api/v1/projects/${project.id}/sources`, {
      headers: auth,
    });
    expect(sources.status).toBe(200);
    expect(await sources.json()).toMatchObject({
      data: { sources: [expect.objectContaining({ id: source.id })] },
    });

    ctx!.work.items.update(ticket.id, {
      attention: "stale",
      syncState: "stale",
      lastError: "No longer present in the source active-work snapshot",
    });
    const resolve = await fetch(`${baseUrl}/api/v1/work/${ticket.id}/resolve`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ note: "Closed upstream" }),
    });
    expect(resolve.status).toBe(200);
    expect(await resolve.json()).toMatchObject({
      data: {
        work: {
          attention: "none",
          resolution: "operator",
          resolutionNote: "Closed upstream",
          delivery: "open",
        },
      },
    });
    const recheck = await fetch(`${baseUrl}/api/v1/work/${ticket.id}/recheck`, {
      method: "POST",
      headers: auth,
    });
    expect(recheck.status).toBe(200);
    expect(await recheck.json()).toMatchObject({
      data: { result: { status: "unresolved" } },
    });

    const progress = await fetch(`${baseUrl}/api/v1/runs/${run.id}/progress`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        title: "Implementing command center",
        summary: "Storage is complete",
        references: ["OPS-7"],
      }),
    });
    expect(progress.status).toBe(200);
    expect(ctx!.work.items.findById(run.workItemId ?? "")).toMatchObject({
      title: "maintain-work",
      summary: "Implementing command center — Storage is complete",
    });

    const history = await fetch(
      `${baseUrl}/api/v1/projects/${project.id}/work?history=1&limit=25`,
      { headers: auth },
    );
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as {
      data: { items: Array<{ id: string; resolution: string | null }>; total: number };
    };
    expect(historyBody.data.items.some((item) => item.id === ticket.id)).toBe(true);
  });

  test("direct user service integrates with context", async () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-router-users-`);
    ctx = await createAppContext(tempDir);
    const users = new UserService(ctx.db);
    expect(users.countUsers()).toBe(0);
    await users.createUser("admin", "password-here", "admin");
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

    // Agent-run tokens are hidden from the Settings list by default.
    const users = new UserService(ctx!.db);
    const admin = users.findFirstAdmin();
    expect(admin).toBeTruthy();
    users.createApiTokenForUser(admin!.id, "agent-run-01TESTHIDE", {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const hiddenList = await fetch(`${baseUrl}/api/v1/auth/tokens`, { headers: auth });
    const hiddenBody = (await hiddenList.json()) as {
      data: { tokens: Array<{ name: string }> };
    };
    expect(hiddenBody.data.tokens.every((t) => !t.name.startsWith("agent-run-"))).toBe(true);
    const includeAgent = await fetch(`${baseUrl}/api/v1/auth/tokens?includeAgent=1`, {
      headers: auth,
    });
    const includeBody = (await includeAgent.json()) as {
      data: { tokens: Array<{ name: string }> };
    };
    expect(includeBody.data.tokens.some((t) => t.name.startsWith("agent-run-"))).toBe(true);

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
      data: {
        git: boolean;
        disk: boolean;
        database: boolean;
        home: string;
        daemonPath: string;
        tools: Array<{ name: string; found: boolean }>;
        binaryStale: boolean;
        warnings: string[];
      };
    };
    expect(doctorBody.data.disk).toBe(true);
    expect(doctorBody.data.database).toBe(true);
    expect(typeof doctorBody.data.daemonPath).toBe("string");
    expect(doctorBody.data.tools.some((t) => t.name === "bun")).toBe(true);
    expect(doctorBody.data.binaryStale).toBe(false);
    expect(Array.isArray(doctorBody.data.warnings)).toBe(true);

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
    const projectDoctorBody = (await projectDoctor.json()) as {
      data: {
        projectId: string;
        repoExists: boolean;
        baseCheckout: { clean: boolean; dirtyFiles: string[] };
        validationTools: unknown[];
      };
    };
    expect(projectDoctorBody.data.repoExists).toBe(true);
    expect(projectDoctorBody.data.baseCheckout).toBeTruthy();
    expect(Array.isArray(projectDoctorBody.data.validationTools)).toBe(true);

    const adapterTest = await fetch(`${baseUrl}/api/v1/adapters/shell/test`, {
      method: "POST",
      headers: auth,
    });
    expect(adapterTest.status).toBe(200);
    const adapterBody = (await adapterTest.json()) as {
      data: { result: { exitCode: number; stdout: string } };
    };
    expect(adapterBody.data.result.exitCode).toBe(0);
    expect(adapterBody.data.result.stdout).toContain("gojo-agent-test");

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
      body: JSON.stringify({
        slack: { type: "slack", webhookUrl: "https://example.invalid/hook" },
      }),
    });
    expect(channelsPut.status).toBe(200);

    const deleted = await fetch(`${baseUrl}/api/v1/projects/${projectBody.data.project.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(deleted.status).toBe(200);
  });

  test("notification channel validation and test send", async () => {
    const { baseUrl, token } = await boot();
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const invalid = await fetch(`${baseUrl}/api/v1/notification-channels`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ slack: { webhookUrl: "https://example.invalid/hook" } }),
    });
    expect(invalid.status).toBe(400);

    const valid = await fetch(`${baseUrl}/api/v1/notification-channels`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        eng: { type: "webhook", webhookUrl: "https://example.test/hook" },
        ops: {
          type: "telegram",
          botToken: "123456:ABC-DEF",
          chatId: "-1001234567890",
        },
      }),
    });
    expect(valid.status).toBe(200);

    const telegramWebhookOnly = await fetch(`${baseUrl}/api/v1/notification-channels`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        bad: { type: "telegram", webhookUrl: "https://example.test/hook" },
      }),
    });
    expect(telegramWebhookOnly.status).toBe(400);

    let received: unknown = null;
    const webhookServer = Bun.serve({
      port: 0,
      fetch: async (request) => {
        received = await request.json();
        return new Response("ok", { status: 200 });
      },
    });

    try {
      const testOk = await fetch(`${baseUrl}/api/v1/notification-channels/test`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          type: "webhook",
          webhookUrl: `${webhookServer.url.toString().replace(/\/$/, "")}/hook`,
        }),
      });
      expect(testOk.status).toBe(200);
      expect(received).toMatchObject({ test: true, project: "gojo-test" });

      const failingWebhook = Bun.serve({
        port: 0,
        fetch: () => new Response("nope", { status: 500 }),
      });
      try {
        const secretUrl = `${failingWebhook.url.toString().replace(/\/$/, "")}/secret-token-xyz`;
        const testFail = await fetch(`${baseUrl}/api/v1/notification-channels/test`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            type: "webhook",
            webhookUrl: secretUrl,
          }),
        });
        expect(testFail.status).toBe(502);
        const failBody = (await testFail.json()) as { error: { message: string } };
        expect(failBody.error.message).not.toContain("secret-token-xyz");
      } finally {
        failingWebhook.stop();
      }
    } finally {
      webhookServer.stop();
    }
  });

  test("lists all agents without projectId and scopes when provided", async () => {
    const { baseUrl, token } = await boot();
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const projectA = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "alpha", repoPath: `${tempDir}/alpha` }),
    });
    expect(projectA.status).toBe(201);
    const { data: dataA } = (await projectA.json()) as { data: { project: { id: string } } };

    const projectB = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "beta", repoPath: `${tempDir}/beta` }),
    });
    expect(projectB.status).toBe(201);
    const { data: dataB } = (await projectB.json()) as { data: { project: { id: string } } };

    for (const [projectId, name] of [
      [dataA.project.id, "agent-a"],
      [dataB.project.id, "agent-b"],
    ] as const) {
      const created = await fetch(`${baseUrl}/api/v1/agents`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          projectId,
          name,
          prompt: "echo ok",
        }),
      });
      expect(created.status).toBe(201);
    }

    const allResponse = await fetch(`${baseUrl}/api/v1/agents`, { headers: auth });
    expect(allResponse.status).toBe(200);
    const allBody = (await allResponse.json()) as {
      data: {
        agents: Array<{ name: string; projectId: string; projectName: string | null }>;
        total: number;
        limit: number;
        offset: number;
      };
    };
    expect(allBody.data.agents.map((t) => t.name).sort()).toEqual(["agent-a", "agent-b"]);
    expect(allBody.data.agents.every((t) => t.projectName)).toBe(true);
    expect(allBody.data.total).toBe(2);
    expect(allBody.data.limit).toBe(25);
    expect(allBody.data.offset).toBe(0);

    const scoped = await fetch(
      `${baseUrl}/api/v1/agents?projectId=${encodeURIComponent(dataA.project.id)}`,
      { headers: auth },
    );
    expect(scoped.status).toBe(200);
    const scopedBody = (await scoped.json()) as {
      data: { agents: Array<{ name: string; projectId: string }>; total: number };
    };
    expect(scopedBody.data.agents).toHaveLength(1);
    expect(scopedBody.data.total).toBe(1);
    expect(scopedBody.data.agents[0]?.name).toBe("agent-a");
    expect(scopedBody.data.agents[0]?.projectId).toBe(dataA.project.id);

    const paged = await fetch(`${baseUrl}/api/v1/agents?limit=1&offset=1`, { headers: auth });
    expect(paged.status).toBe(200);
    const pagedBody = (await paged.json()) as {
      data: {
        agents: Array<{
          name: string;
          lastRunId: string | null;
          lastRunState: string | null;
          lastRunCreatedAt: string | null;
        }>;
        total: number;
        limit: number;
        offset: number;
      };
    };
    expect(pagedBody.data.agents).toHaveLength(1);
    expect(pagedBody.data.total).toBe(2);
    expect(pagedBody.data.limit).toBe(1);
    expect(pagedBody.data.offset).toBe(1);
    expect(pagedBody.data.agents[0]).toHaveProperty("lastRunId");
    expect(pagedBody.data.agents[0]).toHaveProperty("lastRunState");
    expect(pagedBody.data.agents[0]).toHaveProperty("lastRunCreatedAt");
  });

  test("GET agent by id returns enriched agent with source and 404", async () => {
    const { baseUrl, token } = await boot();
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "detail-demo", repoPath: tempDir ?? "/tmp/demo" }),
    });
    expect(projectRes.status).toBe(201);
    const projectBody = (await projectRes.json()) as { data: { project: { id: string } } };

    ctx!.repos.projects.update(projectBody.data.project.id, {
      manifestJson: JSON.stringify({
        version: 1,
        project: { name: "detail-demo" },
        repository: { defaultBranch: "main" },
        profiles: { shell: { adapter: "shell", command: "bash" } },
        validationProfiles: { none: { steps: [] } },
        agents: {
          "detail-agent": {
            description: "An agent",
            profile: "shell",
            promptFile: ".gojo/prompts/detail.md",
            validationProfile: "none",
          },
        },
      }),
    });

    const agentRes = await fetch(`${baseUrl}/api/v1/agents`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        projectId: projectBody.data.project.id,
        name: "detail-agent",
        prompt: "do work",
        description: "An agent",
      }),
    });
    expect(agentRes.status).toBe(201);
    const agentBody = (await agentRes.json()) as { data: { agent: { id: string } } };
    const agentId = agentBody.data.agent.id;

    const got = await fetch(`${baseUrl}/api/v1/agents/${agentId}`, { headers: auth });
    expect(got.status).toBe(200);
    const body = (await got.json()) as {
      data: {
        agent: {
          id: string;
          name: string;
          projectName: string | null;
          recentRuns: unknown[];
          source: {
            repoPath: string;
            manifestPath: string | null;
            promptFile: string | null;
            promptAbsolutePath: string | null;
          };
        };
      };
    };
    expect(body.data.agent.id).toBe(agentId);
    expect(body.data.agent.name).toBe("detail-agent");
    expect(body.data.agent.projectName).toBe("detail-demo");
    expect(Array.isArray(body.data.agent.recentRuns)).toBe(true);
    expect(body.data.agent.source.promptFile).toBe(".gojo/prompts/detail.md");
    expect(body.data.agent.source.promptAbsolutePath).toContain(".gojo/prompts/detail.md");

    const missing = await fetch(`${baseUrl}/api/v1/agents/does-not-exist`, { headers: auth });
    expect(missing.status).toBe(404);
  });

  test("schedules list filters by agentId", async () => {
    const { baseUrl, token } = await boot();
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "sched-filter", repoPath: tempDir ?? "/tmp/demo" }),
    });
    const projectBody = (await projectRes.json()) as { data: { project: { id: string } } };

    const createAgent = async (name: string) => {
      const res = await fetch(`${baseUrl}/api/v1/agents`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          projectId: projectBody.data.project.id,
          name,
          prompt: "run",
        }),
      });
      const body = (await res.json()) as { data: { agent: { id: string } } };
      return body.data.agent.id;
    };

    const agentA = await createAgent("agent-a");
    const agentB = await createAgent("agent-b");
    ctx!.repos.schedules.create({
      agentId: agentA,
      name: "for-a",
      cronExpr: "0 * * * *",
      timezone: "UTC",
    });
    ctx!.repos.schedules.create({
      agentId: agentB,
      name: "for-b",
      cronExpr: "0 0 * * *",
      timezone: "UTC",
    });

    const list = await fetch(
      `${baseUrl}/api/v1/schedules?agentId=${encodeURIComponent(agentA)}`,
      { headers: auth },
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      data: { schedules: Array<{ name: string; agentId: string }>; total: number };
    };
    expect(listBody.data.total).toBe(1);
    expect(listBody.data.schedules).toHaveLength(1);
    expect(listBody.data.schedules[0]?.name).toBe("for-a");
    expect(listBody.data.schedules[0]?.agentId).toBe(agentA);
  });

  test("agent enable and disable toggle enabled flag", async () => {
    const { baseUrl, token } = await boot();
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "toggle-demo", repoPath: tempDir ?? "/tmp/demo" }),
    });
    expect(projectRes.status).toBe(201);
    const projectBody = (await projectRes.json()) as { data: { project: { id: string } } };

    const agentRes = await fetch(`${baseUrl}/api/v1/agents`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        projectId: projectBody.data.project.id,
        name: "toggle-me",
        prompt: "echo ok",
      }),
    });
    expect(agentRes.status).toBe(201);
    const agentBody = (await agentRes.json()) as {
      data: { agent: { id: string; enabled: boolean } };
    };
    expect(agentBody.data.agent.enabled).toBe(true);
    const agentId = agentBody.data.agent.id;

    const disabled = await fetch(`${baseUrl}/api/v1/agents/${agentId}/disable`, {
      method: "POST",
      headers: auth,
    });
    expect(disabled.status).toBe(200);
    const disabledBody = (await disabled.json()) as {
      data: { agent: { id: string; enabled: boolean } };
    };
    expect(disabledBody.data.agent.id).toBe(agentId);
    expect(disabledBody.data.agent.enabled).toBe(false);

    const enabled = await fetch(`${baseUrl}/api/v1/agents/${agentId}/enable`, {
      method: "POST",
      headers: auth,
    });
    expect(enabled.status).toBe(200);
    const enabledBody = (await enabled.json()) as {
      data: { agent: { id: string; enabled: boolean } };
    };
    expect(enabledBody.data.agent.enabled).toBe(true);

    const missing = await fetch(`${baseUrl}/api/v1/agents/does-not-exist/disable`, {
      method: "POST",
      headers: auth,
    });
    expect(missing.status).toBe(404);
  });

  test("schedules list includes cronDescription and upcoming fires", async () => {
    const { baseUrl, token } = await boot();
    const auth = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "sched-demo", repoPath: tempDir ?? "/tmp/demo" }),
    });
    expect(projectRes.status).toBe(201);
    const projectBody = (await projectRes.json()) as { data: { project: { id: string } } };

    const agentRes = await fetch(`${baseUrl}/api/v1/agents`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        projectId: projectBody.data.project.id,
        name: "nightly",
        prompt: "run",
      }),
    });
    expect(agentRes.status).toBe(201);
    const agentBody = (await agentRes.json()) as { data: { agent: { id: string } } };

    ctx!.repos.schedules.create({
      agentId: agentBody.data.agent.id,
      name: "hourly",
      cronExpr: "0 * * * *",
      timezone: "UTC",
      enabled: true,
    });

    const list = await fetch(`${baseUrl}/api/v1/schedules`, { headers: auth });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      data: { schedules: Array<{ cronDescription?: string; cronExpr: string }> };
    };
    expect(listBody.data.schedules.length).toBeGreaterThan(0);
    expect(listBody.data.schedules[0]!.cronDescription?.toLowerCase()).toContain("hour");

    const upcoming = await fetch(`${baseUrl}/api/v1/schedules/upcoming?horizonHours=24`, {
      headers: auth,
    });
    expect(upcoming.status).toBe(200);
    const upcomingBody = (await upcoming.json()) as {
      data: {
        horizonHours: number;
        schedules: Array<{ color: string; fires: string[] }>;
      };
    };
    expect(upcomingBody.data.horizonHours).toBe(24);
    expect(upcomingBody.data.schedules[0]!.color).toMatch(/^#/);
    expect(upcomingBody.data.schedules[0]!.fires.length).toBeGreaterThan(0);
  });

  test("dashboard impact analytics and run detail expose canonical records", async () => {
    const { baseUrl, token } = await boot();
    const auth = { Authorization: `Bearer ${token}` };

    const project = ctx!.repos.projects.create({
      name: "impact-demo",
      repoPath: tempDir ?? "/tmp/demo",
    });
    const task = ctx!.repos.agents.create({
      projectId: project.id,
      name: "deps",
      prompt: "run",
    });
    const run = ctx!.repos.runs.create({
      projectId: project.id,
      agentId: task.id,
      idempotencyKey: "impact-key",
      trigger: "manual",
    });
    ctx!.db
      .connection()
      .query("UPDATE runs SET state = 'succeeded' WHERE id = ?")
      .run(run.id);
    ctx!.repos.runIntegrations.upsertForRun({
      runId: run.id,
      mode: "pull-request",
      provider: "forgejo",
      prNumber: 9,
      prUrl: "http://forge.local/x/pulls/9",
      status: "merged",
      mergedAt: new Date().toISOString(),
    });
    ctx!.repos.runImpactItems.replaceForRun(run.id, null, [
      {
        category: "dependency-update",
        subject: "left-pad",
        summary: "bumped",
        source: "agent",
        verification: "corroborated",
      },
    ]);

    const impact = await fetch(
      `${baseUrl}/api/v1/dashboard/impact?projectId=${project.id}`,
      { headers: auth },
    );
    expect(impact.status).toBe(200);
    const impactBody = (await impact.json()) as {
      data: {
        totals: { mergedRuns: number; mergeRate: number | null };
        categoryTotals: Array<{ category: string; runs: number }>;
        recentItems: Array<{ subject: string; runId: string }>;
      };
    };
    expect(impactBody.data.totals.mergedRuns).toBe(1);
    expect(impactBody.data.totals.mergeRate).toBe(1);
    expect(impactBody.data.categoryTotals).toEqual([
      { category: "dependency-update", runs: 1 },
    ]);
    expect(impactBody.data.recentItems[0]!.subject).toBe("left-pad");

    // Filters that exclude the run drop it from every aggregate.
    const empty = await fetch(
      `${baseUrl}/api/v1/dashboard/impact?to=2000-01-01T00:00:00.000Z`,
      { headers: auth },
    );
    const emptyBody = (await empty.json()) as {
      data: { totals: { mergedRuns: number; mergeRate: number | null } };
    };
    expect(emptyBody.data.totals.mergedRuns).toBe(0);
    expect(emptyBody.data.totals.mergeRate).toBeNull();

    const detail = await fetch(`${baseUrl}/api/v1/runs/${run.id}`, { headers: auth });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      data: {
        impactItems: Array<{ subject: string }>;
        integration: { status: string; prUrl: string } | null;
      };
    };
    expect(detailBody.data.impactItems).toHaveLength(1);
    expect(detailBody.data.integration?.status).toBe("merged");
  });

  test("lists open integrations and filters projects by hasOpenPrs", async () => {
    const { baseUrl, token } = await boot();
    const auth = { Authorization: `Bearer ${token}` };

    const project = ctx!.repos.projects.create({
      name: "open-prs",
      repoPath: tempDir ?? "/tmp/open-prs",
    });
    const empty = ctx!.repos.projects.create({
      name: "no-prs",
      repoPath: `${tempDir ?? "/tmp"}/no-prs`,
    });
    const task = ctx!.repos.agents.create({
      projectId: project.id,
      name: "maintain-quality",
      prompt: "run",
    });
    const run = ctx!.repos.runs.create({
      projectId: project.id,
      agentId: task.id,
      idempotencyKey: "open-pr-key",
      trigger: "manual",
    });
    ctx!.repos.runIntegrations.upsertForRun({
      runId: run.id,
      mode: "pull-request",
      provider: "github",
      repo: "me/app",
      prNumber: 42,
      prUrl: "https://github.com/me/app/pull/42",
      status: "open",
      openedAt: "2026-07-20T00:00:00.000Z",
      nextCheckAt: "2026-07-27T19:00:00.000Z",
    });

    const defaultRes = await fetch(`${baseUrl}/api/v1/integrations`, { headers: auth });
    expect(defaultRes.status).toBe(200);
    const defaultBody = (await defaultRes.json()) as {
      data: {
        integrations: Array<{ runId: string; status: string }>;
        total: number;
        limit: number;
      };
    };
    expect(defaultBody.data.limit).toBe(25);
    expect(defaultBody.data.total).toBeGreaterThanOrEqual(1);
    expect(defaultBody.data.integrations.some((row) => row.runId === run.id)).toBe(true);

    const badStatus = await fetch(`${baseUrl}/api/v1/integrations?status=closed`, {
      headers: auth,
    });
    expect(badStatus.status).toBe(400);

    const openRes = await fetch(`${baseUrl}/api/v1/integrations?status=open`, { headers: auth });
    expect(openRes.status).toBe(200);
    const openBody = (await openRes.json()) as {
      data: {
        integrations: Array<{
          runId: string;
          prNumber: number | null;
          projectId: string;
          mergedAt: string | null;
        }>;
        total: number;
      };
    };
    expect(openBody.data.total).toBeGreaterThanOrEqual(1);
    expect(openBody.data.integrations.some((row) => row.runId === run.id)).toBe(true);

    const filtered = await fetch(
      `${baseUrl}/api/v1/integrations?status=open&projectId=${project.id}`,
      { headers: auth },
    );
    const filteredBody = (await filtered.json()) as {
      data: { integrations: Array<{ prNumber: number | null }>; total: number };
    };
    expect(filteredBody.data.total).toBe(1);
    expect(filteredBody.data.integrations[0]?.prNumber).toBe(42);

    const mergedRun = ctx!.repos.runs.create({
      projectId: project.id,
      agentId: task.id,
      idempotencyKey: "merged-pr-key",
      trigger: "manual",
    });
    ctx!.repos.runIntegrations.upsertForRun({
      runId: mergedRun.id,
      mode: "pull-request",
      provider: "github",
      repo: "me/app",
      prNumber: 99,
      prUrl: "https://github.com/me/app/pull/99",
      status: "merged",
      openedAt: "2026-07-18T00:00:00.000Z",
      mergedAt: "2026-07-21T00:00:00.000Z",
    });

    const allRes = await fetch(
      `${baseUrl}/api/v1/integrations?status=all&projectId=${project.id}`,
      { headers: auth },
    );
    expect(allRes.status).toBe(200);
    const allBody = (await allRes.json()) as {
      data: { integrations: Array<{ prNumber: number | null; status: string }>; total: number };
    };
    expect(allBody.data.total).toBe(2);
    expect(allBody.data.integrations.map((row) => row.status).sort()).toEqual(["merged", "open"]);

    const mergedRes = await fetch(
      `${baseUrl}/api/v1/integrations?status=merged&projectId=${project.id}`,
      { headers: auth },
    );
    expect(mergedRes.status).toBe(200);
    const mergedBody = (await mergedRes.json()) as {
      data: {
        integrations: Array<{ prNumber: number | null; mergedAt: string | null; status: string }>;
        total: number;
      };
    };
    expect(mergedBody.data.total).toBe(1);
    expect(mergedBody.data.integrations[0]?.prNumber).toBe(99);
    expect(mergedBody.data.integrations[0]?.status).toBe("merged");
    expect(mergedBody.data.integrations[0]?.mergedAt).toBe("2026-07-21T00:00:00.000Z");

    const projectsRes = await fetch(`${baseUrl}/api/v1/projects?hasOpenPrs=true`, {
      headers: auth,
    });
    expect(projectsRes.status).toBe(200);
    const projectsBody = (await projectsRes.json()) as {
      data: { projects: Array<{ id: string; openPrCount: number }>; total: number };
    };
    expect(projectsBody.data.projects.some((row) => row.id === project.id)).toBe(true);
    expect(projectsBody.data.projects.every((row) => row.openPrCount > 0)).toBe(true);
    expect(projectsBody.data.projects.some((row) => row.id === empty.id)).toBe(false);

    const detail = await fetch(`${baseUrl}/api/v1/projects/${project.id}`, { headers: auth });
    const detailBody = (await detail.json()) as {
      data: { project: { openPrCount: number } };
    };
    expect(detailBody.data.project.openPrCount).toBe(1);
  });

  test("approval notification links require confirmation and are single-use", async () => {
    const { baseUrl } = await boot();
    const project = ctx!.repos.projects.create({
      name: "approval-link",
      repoPath: tempDir!,
    });
    const approval = ctx!.approvals.create({
      projectId: project.id,
      subjectType: "pull-request",
      subjectId: "pr-link",
      autonomy: "manual",
      state: "awaiting-human",
      checksState: "success",
      reviewVerdict: "pass",
    });
    const users = new UserService(ctx!.db);
    const admin = users.findFirstAdmin()!;
    const { token } = users.createApiTokenForUser(admin.id, "approval-link-test", {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      scopes: [`control:approve:${approval.id}`],
    });
    const link = `${baseUrl}/api/v1/approvals/${approval.id}/approve-link`;

    const confirmation = await fetch(`${link}?token=${encodeURIComponent(token)}`);
    expect(confirmation.status).toBe(200);
    expect(await confirmation.text()).toContain("Approve merge?");

    const applied = await fetch(link, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    expect(applied.status).toBe(409);

    const reused = await fetch(`${link}?token=${encodeURIComponent(token)}`);
    expect(reused.status).toBe(403);
  });
});


