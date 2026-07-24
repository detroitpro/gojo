import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAppContext } from "@/app/context";
import { RunState } from "@shared/run-states";

describe("notifications/hooks", () => {
  let tempDir: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;

  afterEach(async () => {
    await ctx?.dispose();
    ctx = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("enqueues webhook notification on successful run.finished", async () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-hooks-`);
    ctx = await createAppContext(tempDir);

    ctx.db
      .connection()
      .query(
        `INSERT INTO instance_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(
        "notification_channels",
        JSON.stringify({
          eng: { type: "webhook", webhookUrl: "https://example.test/hook" },
        }),
        new Date().toISOString(),
      );

    const project = ctx.repos.projects.create({
      name: "notify-demo",
      repoPath: tempDir,
      manifestJson: JSON.stringify({
        version: 1,
        project: { name: "notify-demo", defaultBranch: "main" },
        repository: {
          remote: "origin",
          syncBeforeRun: false,
          requireCleanBase: false,
          submodules: false,
          gitLfs: false,
        },
        agents: { shell: { adapter: "shell" } },
        validationProfiles: {
          quick: { steps: [{ name: "ok", command: "true" }] },
        },
        tasks: {
          t: {
            description: "t",
            agent: "shell",
            promptFile: "x.sh",
            validationProfile: "quick",
          },
        },
        notifications: { onSuccess: ["eng"] },
      }),
    });

    const task = ctx.repos.tasks.create({
      projectId: project.id,
      name: "t",
      prompt: "#!/bin/sh\ntrue\n",
    });

    const run = await ctx.coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      trigger: "manual",
    });

    ctx.repos.runs.update(run.id, {
      state: RunState.Succeeded,
      finishedAt: new Date().toISOString(),
    });

    ctx.eventBus.emit({
      type: "run.finished",
      runId: run.id,
      at: new Date().toISOString(),
      data: { state: RunState.Succeeded },
    });

    await Bun.sleep(80);

    const row = ctx.db
      .connection()
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM notifications WHERE run_id = ?",
      )
      .get(run.id);

    expect(row?.count ?? 0).toBeGreaterThanOrEqual(1);
  });
});

