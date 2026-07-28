import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppContext } from "@/app/context";
import type { NotificationsConfig } from "@shared/manifest";
import { RunState } from "@shared/run-states";

function manifestJson(
  name: string,
  options: {
    projectNotifications?: NotificationsConfig;
    taskNotifications?: NotificationsConfig;
  } = {},
): string {
  return JSON.stringify({
    version: 1,
    project: { name, defaultBranch: "main" },
    repository: {
      remote: "origin",
      syncBeforeRun: false,
      requireCleanBase: false,
      submodules: false,
      gitLfs: false,
    },
    agents: { shell: { adapter: "shell" } },
    validationProfiles: { quick: { steps: [{ name: "ok", command: "true" }] } },
    tasks: {
      t: {
        description: "t",
        agent: "shell",
        promptFile: "x.sh",
        validationProfile: "quick",
        ...(options.taskNotifications ? { notifications: options.taskNotifications } : {}),
      },
    },
    notifications: options.projectNotifications ?? {},
  });
}

describe("notifications/hooks", () => {
  let tempDir: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;

  function channelPayloads(runId: string): Array<{ channel: string; payload: Record<string, unknown> }> {
    return ctx!.db
      .connection()
      .query<{ channel: string; payload_json: string }, [string]>(
        "SELECT channel, payload_json FROM notifications WHERE run_id = ?",
      )
      .all(runId)
      .map((row) => {
        const parsed = JSON.parse(row.payload_json) as {
          channel: { id: string };
          payload: Record<string, unknown>;
        };
        return { channel: parsed.channel.id, payload: parsed.payload };
      });
  }

  function seedChannels(names: string[]): void {
    const channels = Object.fromEntries(
      names.map((name) => [name, { type: "webhook", webhookUrl: `https://example.test/${name}` }]),
    );
    ctx!.db
      .connection()
      .query("INSERT INTO instance_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
      .run("notification_channels", JSON.stringify(channels), new Date().toISOString());
  }

  async function finishRun(projectId: string, taskId: string): Promise<string> {
    const run = await ctx!.coordinator.createRun({ projectId, taskId, trigger: "manual" });
    ctx!.repos.runs.update(run.id, {
      state: RunState.Succeeded,
      finishedAt: new Date().toISOString(),
    });
    ctx!.eventBus.emit({
      type: "run.finished",
      runId: run.id,
      at: new Date().toISOString(),
      data: { state: RunState.Succeeded },
    });
    await Bun.sleep(120);
    return run.id;
  }

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

  test("auto-disables schedule and enqueues onDisabled channels", async () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-hooks-disable-`);
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
          ops: { type: "webhook", webhookUrl: "https://example.test/ops" },
        }),
        new Date().toISOString(),
      );

    const project = ctx.repos.projects.create({
      name: "disable-demo",
      repoPath: tempDir,
      manifestJson: JSON.stringify({
        version: 1,
        project: { name: "disable-demo", defaultBranch: "main" },
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
        notifications: {
          onFailure: ["ops"],
          onDisabled: ["ops"],
        },
      }),
    });

    const task = ctx.repos.tasks.create({
      projectId: project.id,
      name: "t",
      prompt: "#!/bin/sh\ntrue\n",
    });

    const schedule = ctx.repos.schedules.create({
      taskId: task.id,
      name: "nightly",
      cronExpr: "0 3 * * *",
      disableAfter: 1,
      enabled: true,
    });

    const run = await ctx.coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      scheduleId: schedule.id,
      trigger: "schedule",
    });

    ctx.repos.runs.update(run.id, {
      state: RunState.Failed,
      finishedAt: new Date().toISOString(),
      errorMessage: "boom",
    });

    ctx.eventBus.emit({
      type: "run.finished",
      runId: run.id,
      at: new Date().toISOString(),
      data: { state: RunState.Failed },
    });

    await Bun.sleep(120);

    const updated = ctx.repos.schedules.findById(schedule.id);
    expect(updated?.enabled).toBe(false);
    expect(updated?.consecutiveFailures).toBeGreaterThanOrEqual(1);

    const rows = ctx.db
      .connection()
      .query<{ payload_json: string }, [string]>(
        "SELECT payload_json FROM notifications WHERE run_id = ?",
      )
      .all(run.id);

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const payloads = rows.map((row) => {
      const parsed = JSON.parse(row.payload_json) as { payload: Record<string, unknown> };
      return parsed.payload;
    });
    expect(payloads.some((payload) => payload["reason"] === "schedule auto-disabled")).toBe(true);
  });

  test("task routing notifies alone when project routing is empty", async () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-hooks-task-`);
    ctx = await createAppContext(tempDir);
    seedChannels(["digest"]);

    const project = ctx.repos.projects.create({
      name: "task-routed",
      repoPath: tempDir,
      manifestJson: manifestJson("task-routed", {
        projectNotifications: {},
        taskNotifications: { onSuccess: ["digest"] },
      }),
    });

    const routed = ctx.repos.tasks.create({
      projectId: project.id,
      name: "t",
      prompt: "#!/bin/sh\ntrue\n",
      notificationsJson: JSON.stringify({ onSuccess: ["digest"] }),
    });
    const silent = ctx.repos.tasks.create({
      projectId: project.id,
      name: "other",
      prompt: "#!/bin/sh\ntrue\n",
    });

    const routedRun = await finishRun(project.id, routed.id);
    const silentRun = await finishRun(project.id, silent.id);

    expect(channelPayloads(routedRun).map((entry) => entry.channel)).toEqual(["digest"]);
    expect(channelPayloads(silentRun)).toHaveLength(0);
  });

  test("task routing replaces project routing rather than merging", async () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-hooks-replace-`);
    ctx = await createAppContext(tempDir);
    seedChannels(["everyone", "digest"]);

    const project = ctx.repos.projects.create({
      name: "replaced",
      repoPath: tempDir,
      manifestJson: manifestJson("replaced", {
        projectNotifications: { onSuccess: ["everyone"] },
        taskNotifications: { onSuccess: ["digest"] },
      }),
    });

    const overridden = ctx.repos.tasks.create({
      projectId: project.id,
      name: "t",
      prompt: "#!/bin/sh\ntrue\n",
      notificationsJson: JSON.stringify({ onSuccess: ["digest"] }),
    });
    const inherited = ctx.repos.tasks.create({
      projectId: project.id,
      name: "other",
      prompt: "#!/bin/sh\ntrue\n",
    });

    const overriddenRun = await finishRun(project.id, overridden.id);
    const inheritedRun = await finishRun(project.id, inherited.id);

    expect(channelPayloads(overriddenRun).map((entry) => entry.channel)).toEqual(["digest"]);
    expect(channelPayloads(inheritedRun).map((entry) => entry.channel)).toEqual(["everyone"]);
  });

  test("payload carries the agent-authored handoff summary", async () => {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-hooks-summary-`);
    ctx = await createAppContext(tempDir);
    seedChannels(["digest"]);

    const project = ctx.repos.projects.create({
      name: "summarized",
      repoPath: tempDir,
      manifestJson: manifestJson("summarized", {
        taskNotifications: { onSuccess: ["digest"] },
      }),
    });

    const task = ctx.repos.tasks.create({
      projectId: project.id,
      name: "t",
      prompt: "#!/bin/sh\ntrue\n",
      notificationsJson: JSON.stringify({ onSuccess: ["digest"] }),
    });

    const run = await ctx.coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      trigger: "manual",
    });

    const artifactDir = join(ctx.paths.artifacts, run.id);
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, "handoff.json"),
      JSON.stringify({ status: "no-change", summary: "gojo — last 24h\n\nMerged (1)\n- #21 fix" }),
      "utf8",
    );

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
    await Bun.sleep(120);

    const [entry] = channelPayloads(run.id);
    expect(entry?.payload["summary"]).toContain("Merged (1)");
    expect(entry?.payload["handoffStatus"]).toBe("no-change");
  });
});

