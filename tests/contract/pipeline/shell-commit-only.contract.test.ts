/**
 * Behavior lock: shell agent → Succeeded in commit-only mode via HTTP API.
 * Guards Execution-context migration (Phase 8). Do not weaken during refactor.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppContext } from "@/platform/app-context";
import { createRouter } from "@/transports/http/router";
import { commitAll, configLocal, execGit, initRepo } from "@/infrastructure/git/git";
import { RunState } from "@shared/run-states";

describe("contract/pipeline/shell-commit-only", () => {
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

  test("API setup → project → agent → run reaches Succeeded with gojo branch", async () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-contract-pipeline-`);
    const repoPath = join(tempDir, "repo");
    mkdirSync(repoPath, { recursive: true });

    await initRepo(repoPath);
    await configLocal(repoPath, "user.email", "test@example.com");
    await configLocal(repoPath, "user.name", "Gojo Test");
    writeFileSync(join(repoPath, "README.md"), "# contract pipeline\n");
    await commitAll(repoPath, "initial");

    ctx = await createAppContext(tempDir);
    ctx.dispatcher.start();
    const handler = createRouter(ctx);
    server = Bun.serve({
      port: 0,
      fetch: async (req, bunServer) => (await handler(req, bunServer)) ?? undefined!,
    });
    const baseUrl = server.url.toString().replace(/\/$/, "");

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
    const cookie = login.headers.get("Set-Cookie") ?? "";
    const tokenResponse = await fetch(`${baseUrl}/api/v1/auth/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "pipeline" }),
    });
    const { data: tokenData } = (await tokenResponse.json()) as { data: { token: string } };
    const auth = {
      Authorization: `Bearer ${tokenData.token}`,
      "Content-Type": "application/json",
    };

    const projectResponse = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "demo", repoPath }),
    });
    expect(projectResponse.status).toBe(201);
    const { data: projectData } = (await projectResponse.json()) as {
      data: { project: { id: string } };
    };

    const agentResponse = await fetch(`${baseUrl}/api/v1/agents`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        projectId: projectData.project.id,
        name: "create-file",
        prompt: ["#!/bin/sh", "set -eu", 'echo "agent output" > agent-result.txt'].join("\n"),
        validationProfileJson: JSON.stringify({
          steps: [{ name: "file-exists", command: "test -f agent-result.txt" }],
        }),
        integrationJson: JSON.stringify({
          mode: "commit-only",
          targetBranch: "main",
        }),
      }),
    });
    expect(agentResponse.status).toBe(201);
    const { data: agentData } = (await agentResponse.json()) as { data: { agent: { id: string } } };

    const runResponse = await fetch(`${baseUrl}/api/v1/agents/${agentData.agent.id}/run`, {
      method: "POST",
      headers: auth,
    });
    expect(runResponse.status).toBe(202);
    const { data: runData } = (await runResponse.json()) as { data: { run: { id: string } } };

    await ctx.dispatcher.waitForTerminal(runData.run.id, { pollMs: 100, maxMs: 60_000 });
    const finished = ctx.repos.runs.findById(runData.run.id);
    expect(finished?.state).toBe(RunState.Succeeded);
    expect(finished?.finishedAt).not.toBeNull();

    const detail = await fetch(`${baseUrl}/api/v1/runs/${runData.run.id}`, { headers: auth });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      data: { run: { state: string; branchName: string | null } };
    };
    expect(detailBody.data.run.state).toBe(RunState.Succeeded);

    const attempts = ctx.repos.attempts.listByRun(runData.run.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.resultCommit).toMatch(/^[0-9a-f]{40}$/);

    const branches = await execGit(repoPath, ["branch", "--list", "gojo/*"]);
    expect(branches.exitCode).toBe(0);
    expect(branches.stdout).toContain("gojo/");

    const events = ctx.platformEvents
      .list({ afterSequence: 0, projectId: projectData.project.id })
      .filter((event) => event.entityId === runData.run.id)
      .map((event) => event.type);
    expect(events).toEqual(
      expect.arrayContaining(["run.created", "run.state_changed", "run.finished"]),
    );
  }, 60_000);
});
