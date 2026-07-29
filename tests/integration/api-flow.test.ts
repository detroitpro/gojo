import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppContext } from "@/app/context";
import { createRouter } from "@/api/router";
import { commitAll, configLocal, initRepo } from "@/git/git";
import { RunState } from "@shared/run-states";

describe("integration/api-flow", () => {
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

  test("setup -> project -> task -> run succeeds", async () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-api-flow-`);
    const repoPath = join(tempDir, "repo");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(repoPath, { recursive: true });

    await initRepo(repoPath);
    await configLocal(repoPath, "user.email", "test@example.com");
    await configLocal(repoPath, "user.name", "Gojo Test");
    writeFileSync(join(repoPath, "README.md"), "# api flow\n");
    await commitAll(repoPath, "initial");

    ctx = await createAppContext(tempDir);
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

    const tokenResponse = await fetch(`${baseUrl}/api/v1/auth/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: (
          await fetch(`${baseUrl}/api/v1/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "admin", password: "secret-pass" }),
          })
        ).headers.get("Set-Cookie") ?? "",
      },
      body: JSON.stringify({ name: "test" }),
    });
    const { data: tokenData } = (await tokenResponse.json()) as { data: { token: string } };
    const auth = { Authorization: `Bearer ${tokenData.token}` };

    const projectResponse = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "demo", repoPath }),
    });
    expect(projectResponse.status).toBe(201);
    const { data: projectData } = (await projectResponse.json()) as {
      data: { project: { id: string } };
    };

    const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
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
          commitMessage: "gojo: add agent-result.txt",
        }),
      }),
    });
    expect(taskResponse.status).toBe(201);
    const { data: taskData } = (await taskResponse.json()) as { data: { task: { id: string } } };

    const runResponse = await fetch(`${baseUrl}/api/v1/tasks/${taskData.task.id}/run`, {
      method: "POST",
      headers: auth,
    });
    expect(runResponse.status).toBe(202);
    const { data: runData } = (await runResponse.json()) as { data: { run: { id: string } } };

    let finishedState: string | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const detail = await fetch(`${baseUrl}/api/v1/runs/${runData.run.id}`, { headers: auth });
      const body = (await detail.json()) as { data: { run: { state: string } } };
      finishedState = body.data.run.state;
      if (
        finishedState === RunState.Succeeded ||
        finishedState === RunState.Failed ||
        finishedState === RunState.Canceled
      ) {
        break;
      }
      await Bun.sleep(100);
    }

    expect(finishedState).toBe(RunState.Succeeded);

    const handoffPath = join(tempDir, "artifacts", runData.run.id, "handoff.json");
    expect(existsSync(handoffPath)).toBe(true);
  }, 30_000);
});
