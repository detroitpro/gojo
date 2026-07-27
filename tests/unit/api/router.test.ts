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

  test("lists all tasks without projectId and scopes when provided", async () => {
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
      [dataA.project.id, "task-a"],
      [dataB.project.id, "task-b"],
    ] as const) {
      const created = await fetch(`${baseUrl}/api/v1/tasks`, {
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

    const allResponse = await fetch(`${baseUrl}/api/v1/tasks`, { headers: auth });
    expect(allResponse.status).toBe(200);
    const allBody = (await allResponse.json()) as {
      data: {
        tasks: Array<{ name: string; projectId: string; projectName: string | null }>;
        total: number;
        limit: number;
        offset: number;
      };
    };
    expect(allBody.data.tasks.map((t) => t.name).sort()).toEqual(["task-a", "task-b"]);
    expect(allBody.data.tasks.every((t) => t.projectName)).toBe(true);
    expect(allBody.data.total).toBe(2);
    expect(allBody.data.limit).toBe(25);
    expect(allBody.data.offset).toBe(0);

    const scoped = await fetch(
      `${baseUrl}/api/v1/tasks?projectId=${encodeURIComponent(dataA.project.id)}`,
      { headers: auth },
    );
    expect(scoped.status).toBe(200);
    const scopedBody = (await scoped.json()) as {
      data: { tasks: Array<{ name: string; projectId: string }>; total: number };
    };
    expect(scopedBody.data.tasks).toHaveLength(1);
    expect(scopedBody.data.total).toBe(1);
    expect(scopedBody.data.tasks[0]?.name).toBe("task-a");
    expect(scopedBody.data.tasks[0]?.projectId).toBe(dataA.project.id);

    const paged = await fetch(`${baseUrl}/api/v1/tasks?limit=1&offset=1`, { headers: auth });
    expect(paged.status).toBe(200);
    const pagedBody = (await paged.json()) as {
      data: {
        tasks: Array<{
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
    expect(pagedBody.data.tasks).toHaveLength(1);
    expect(pagedBody.data.total).toBe(2);
    expect(pagedBody.data.limit).toBe(1);
    expect(pagedBody.data.offset).toBe(1);
    expect(pagedBody.data.tasks[0]).toHaveProperty("lastRunId");
    expect(pagedBody.data.tasks[0]).toHaveProperty("lastRunState");
    expect(pagedBody.data.tasks[0]).toHaveProperty("lastRunCreatedAt");
  });

  test("GET task by id returns enriched task with source and 404", async () => {
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
        agents: { shell: { adapter: "shell", command: "bash" } },
        validationProfiles: { none: { steps: [] } },
        tasks: {
          "detail-task": {
            description: "A task",
            agent: "shell",
            promptFile: ".gojo/prompts/detail.md",
            validationProfile: "none",
          },
        },
      }),
    });

    const taskRes = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        projectId: projectBody.data.project.id,
        name: "detail-task",
        prompt: "do work",
        description: "A task",
      }),
    });
    expect(taskRes.status).toBe(201);
    const taskBody = (await taskRes.json()) as { data: { task: { id: string } } };
    const taskId = taskBody.data.task.id;

    const got = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, { headers: auth });
    expect(got.status).toBe(200);
    const body = (await got.json()) as {
      data: {
        task: {
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
    expect(body.data.task.id).toBe(taskId);
    expect(body.data.task.name).toBe("detail-task");
    expect(body.data.task.projectName).toBe("detail-demo");
    expect(Array.isArray(body.data.task.recentRuns)).toBe(true);
    expect(body.data.task.source.promptFile).toBe(".gojo/prompts/detail.md");
    expect(body.data.task.source.promptAbsolutePath).toContain(".gojo/prompts/detail.md");

    const missing = await fetch(`${baseUrl}/api/v1/tasks/does-not-exist`, { headers: auth });
    expect(missing.status).toBe(404);
  });

  test("schedules list filters by taskId", async () => {
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

    const createTask = async (name: string) => {
      const res = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          projectId: projectBody.data.project.id,
          name,
          prompt: "run",
        }),
      });
      const body = (await res.json()) as { data: { task: { id: string } } };
      return body.data.task.id;
    };

    const taskA = await createTask("task-a");
    const taskB = await createTask("task-b");
    ctx!.repos.schedules.create({
      taskId: taskA,
      name: "for-a",
      cronExpr: "0 * * * *",
      timezone: "UTC",
    });
    ctx!.repos.schedules.create({
      taskId: taskB,
      name: "for-b",
      cronExpr: "0 0 * * *",
      timezone: "UTC",
    });

    const list = await fetch(
      `${baseUrl}/api/v1/schedules?taskId=${encodeURIComponent(taskA)}`,
      { headers: auth },
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      data: { schedules: Array<{ name: string; taskId: string }>; total: number };
    };
    expect(listBody.data.total).toBe(1);
    expect(listBody.data.schedules).toHaveLength(1);
    expect(listBody.data.schedules[0]?.name).toBe("for-a");
    expect(listBody.data.schedules[0]?.taskId).toBe(taskA);
  });

  test("task enable and disable toggle enabled flag", async () => {
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

    const taskRes = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        projectId: projectBody.data.project.id,
        name: "toggle-me",
        prompt: "echo ok",
      }),
    });
    expect(taskRes.status).toBe(201);
    const taskBody = (await taskRes.json()) as {
      data: { task: { id: string; enabled: boolean } };
    };
    expect(taskBody.data.task.enabled).toBe(true);
    const taskId = taskBody.data.task.id;

    const disabled = await fetch(`${baseUrl}/api/v1/tasks/${taskId}/disable`, {
      method: "POST",
      headers: auth,
    });
    expect(disabled.status).toBe(200);
    const disabledBody = (await disabled.json()) as {
      data: { task: { id: string; enabled: boolean } };
    };
    expect(disabledBody.data.task.id).toBe(taskId);
    expect(disabledBody.data.task.enabled).toBe(false);

    const enabled = await fetch(`${baseUrl}/api/v1/tasks/${taskId}/enable`, {
      method: "POST",
      headers: auth,
    });
    expect(enabled.status).toBe(200);
    const enabledBody = (await enabled.json()) as {
      data: { task: { id: string; enabled: boolean } };
    };
    expect(enabledBody.data.task.enabled).toBe(true);

    const missing = await fetch(`${baseUrl}/api/v1/tasks/does-not-exist/disable`, {
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

    const taskRes = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        projectId: projectBody.data.project.id,
        name: "nightly",
        prompt: "run",
      }),
    });
    expect(taskRes.status).toBe(201);
    const taskBody = (await taskRes.json()) as { data: { task: { id: string } } };

    ctx!.repos.schedules.create({
      taskId: taskBody.data.task.id,
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
    const task = ctx!.repos.tasks.create({
      projectId: project.id,
      name: "deps",
      prompt: "run",
    });
    const run = ctx!.repos.runs.create({
      projectId: project.id,
      taskId: task.id,
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
        categories: Array<{ category: string; verification: string; count: number }>;
        recentItems: Array<{ subject: string; runId: string }>;
      };
    };
    expect(impactBody.data.totals.mergedRuns).toBe(1);
    expect(impactBody.data.totals.mergeRate).toBe(1);
    expect(impactBody.data.categories).toEqual([
      { category: "dependency-update", verification: "corroborated", count: 1 },
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
    const task = ctx!.repos.tasks.create({
      projectId: project.id,
      name: "maintain-quality",
      prompt: "run",
    });
    const run = ctx!.repos.runs.create({
      projectId: project.id,
      taskId: task.id,
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
    });

    const openRes = await fetch(`${baseUrl}/api/v1/integrations/open`, { headers: auth });
    expect(openRes.status).toBe(200);
    const openBody = (await openRes.json()) as {
      data: {
        integrations: Array<{ runId: string; prNumber: number | null; projectId: string }>;
        total: number;
      };
    };
    expect(openBody.data.total).toBeGreaterThanOrEqual(1);
    expect(openBody.data.integrations.some((row) => row.runId === run.id)).toBe(true);

    const filtered = await fetch(
      `${baseUrl}/api/v1/integrations/open?projectId=${project.id}`,
      { headers: auth },
    );
    const filteredBody = (await filtered.json()) as {
      data: { integrations: Array<{ prNumber: number | null }>; total: number };
    };
    expect(filteredBody.data.total).toBe(1);
    expect(filteredBody.data.integrations[0]?.prNumber).toBe(42);

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
});


