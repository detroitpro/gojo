import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AppContext } from "@/app/context";
import { resolvePaths } from "@/config/paths";
import { commitAll, configLocal, getHead, initRepo } from "@/git/git";
import { getRunArtifacts, getRunDiff } from "@/runs/inspect";
import { Database, createRepositories } from "@/storage";
import { RunState } from "@shared/run-states";

describe("runs/inspect", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function minimalCtx(home: string): { ctx: AppContext; db: Database } {
    const paths = resolvePaths(home);
    mkdirSync(paths.artifacts, { recursive: true });
    const db = Database.open(":memory:");
    db.migrate();
    return {
      ctx: { paths, repos: createRepositories(db) } as AppContext,
      db,
    };
  }

  test("getRunArtifacts loads persisted artifact json files", () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-inspect-artifacts-"));
    const { ctx, db } = minimalCtx(tempDir);
    const runId = "run-artifacts-1";
    const dir = join(ctx.paths.artifacts, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "handoff.json"), JSON.stringify({ status: "completed" }));
    writeFileSync(join(dir, "validation.json"), JSON.stringify({ ok: true }));
    writeFileSync(join(dir, "failure.json"), JSON.stringify({ error: "none" }));

    const result = getRunArtifacts(ctx, runId);

    expect(result.exists).toBe(true);
    expect(result.path).toBe(dir);
    expect(result.handoff).toEqual({ status: "completed" });
    expect(result.validation).toEqual({ ok: true });
    expect(result.failure).toEqual({ error: "none" });
    db.close();
  });

  test("getRunDiff returns changed files from attempt workspace", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-inspect-diff-"));
    const { ctx, db } = minimalCtx(tempDir);
    const workspace = join(tempDir, "workspace");
    mkdirSync(workspace, { recursive: true });

    await initRepo(workspace);
    await configLocal(workspace, "user.email", "test@example.com");
    await configLocal(workspace, "user.name", "Gojo Test");
    writeFileSync(join(workspace, "README.md"), "# inspect\n");
    await commitAll(workspace, "initial");
    const startingCommit = await getHead(workspace);
    writeFileSync(join(workspace, "delta.txt"), "changed\n");

    const project = ctx.repos.projects.create({
      name: "demo",
      repoPath: workspace,
    });
    const task = ctx.repos.tasks.create({
      projectId: project.id,
      name: "task",
      prompt: "work",
    });
    const run = ctx.repos.runs.create({
      projectId: project.id,
      taskId: task.id,
      idempotencyKey: "inspect-diff",
      trigger: "manual",
      state: RunState.Succeeded,
    });
    ctx.repos.attempts.create({
      runId: run.id,
      attemptNumber: 1,
      workspacePath: workspace,
      startingCommit,
    });

    const diff = await getRunDiff(ctx, run.id);

    expect(diff.files).toContain("delta.txt");
    db.close();
  });
});
