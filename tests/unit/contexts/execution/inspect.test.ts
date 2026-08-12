import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AppContext } from "@/platform/app-context";
import { resolvePaths } from "@/platform/config/paths";
import { commitAll, configLocal, getHead, initRepo } from "@/infrastructure/git/git";
import { getRunArtifacts, resolveRunHandoffSummary } from "@/contexts/execution/application/inspect";
import { getRunDiff } from "@/contexts/execution/infrastructure/run-workspace-diff";
import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from "@/infrastructure/persistence";
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
    const task = ctx.repos.agents.create({
      projectId: project.id,
      name: "task",
      prompt: "work",
    });
    const run = ctx.repos.runs.create({
      projectId: project.id,
      agentId: task.id,
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

  test("resolveRunHandoffSummary reads merged artifact handoff.json", () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-inspect-handoff-artifact-"));
    const { ctx, db } = minimalCtx(tempDir);
    const runId = "run-handoff-artifact";
    const dir = join(ctx.paths.artifacts, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "handoff.json"),
      JSON.stringify({ summary: "Shipped fix", status: "completed" }),
    );

    expect(resolveRunHandoffSummary(ctx, runId)).toEqual({
      summary: "Shipped fix",
      status: "completed",
    });
    db.close();
  });

  test("resolveRunHandoffSummary falls back to attempt handoff when artifact is absent", () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-inspect-handoff-attempt-"));
    const { ctx, db } = minimalCtx(tempDir);
    const project = ctx.repos.projects.create({
      name: "demo",
      repoPath: join(tempDir, "repo"),
    });
    const task = ctx.repos.agents.create({
      projectId: project.id,
      name: "task",
      prompt: "work",
    });
    const run = ctx.repos.runs.create({
      projectId: project.id,
      agentId: task.id,
      idempotencyKey: "inspect-handoff-fallback",
      trigger: "manual",
      state: RunState.Failed,
    });
    const attempt = ctx.repos.attempts.create({
      runId: run.id,
      attemptNumber: 1,
    });
    ctx.repos.attempts.update(attempt.id, {
      handoffJson: JSON.stringify({ summary: "Validation failed", status: "failed" }),
    });

    expect(resolveRunHandoffSummary(ctx, run.id)).toEqual({
      summary: "Validation failed",
      status: "failed",
    });
    db.close();
  });

  test("resolveRunHandoffSummary skips corrupt artifact json and uses attempt handoff", () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-inspect-handoff-corrupt-"));
    const { ctx, db } = minimalCtx(tempDir);
    const runId = "run-handoff-corrupt";
    const dir = join(ctx.paths.artifacts, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "handoff.json"), "{ not-json");

    const project = ctx.repos.projects.create({
      name: "demo",
      repoPath: join(tempDir, "repo"),
    });
    const task = ctx.repos.agents.create({
      projectId: project.id,
      name: "task",
      prompt: "work",
    });
    const run = ctx.repos.runs.create({
      projectId: project.id,
      agentId: task.id,
      idempotencyKey: "inspect-handoff-corrupt",
      trigger: "manual",
      state: RunState.Failed,
    });
    const attempt = ctx.repos.attempts.create({
      runId: run.id,
      attemptNumber: 1,
    });
    ctx.repos.attempts.update(attempt.id, {
      handoffJson: JSON.stringify({ summary: "From attempt", status: "failed" }),
    });

    expect(resolveRunHandoffSummary(ctx, run.id)).toEqual({
      summary: "From attempt",
      status: "failed",
    });
    db.close();
  });

  test("resolveRunHandoffSummary returns nulls when handoff has no usable fields", () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-inspect-handoff-empty-"));
    const { ctx, db } = minimalCtx(tempDir);
    const runId = "run-handoff-empty";
    const dir = join(ctx.paths.artifacts, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "handoff.json"), JSON.stringify({}));

    expect(resolveRunHandoffSummary(ctx, runId)).toEqual({
      summary: null,
      status: null,
    });
    db.close();
  });

  test("getRunDiff throws when attempt workspace is unavailable", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-inspect-diff-missing-"));
    const { ctx, db } = minimalCtx(tempDir);
    const project = ctx.repos.projects.create({
      name: "demo",
      repoPath: join(tempDir, "repo"),
    });
    const task = ctx.repos.agents.create({
      projectId: project.id,
      name: "task",
      prompt: "work",
    });
    const run = ctx.repos.runs.create({
      projectId: project.id,
      agentId: task.id,
      idempotencyKey: "inspect-diff-missing",
      trigger: "manual",
      state: RunState.Failed,
    });
    ctx.repos.attempts.create({
      runId: run.id,
      attemptNumber: 1,
    });

    await expect(getRunDiff(ctx, run.id)).rejects.toThrow("attempt workspace not available");
    db.close();
  });
});
