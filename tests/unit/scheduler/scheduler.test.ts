import { afterEach, describe, expect, test } from "bun:test";

import { RunState } from "@shared/run-states";

import { Database, createRepositories } from "@/storage";
import { Scheduler } from "@/scheduler/scheduler";

describe("scheduler/scheduler", () => {
  let db: Database | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
  });

  function setupSchedule(nextRunAt: string) {
    db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const task = repos.agents.create({ projectId: project.id, name: "task", prompt: "go" });
    const schedule = repos.schedules.create({
      agentId: task.id,
      name: "hourly",
      cronExpr: "0 * * * *",
      timezone: "UTC",
      nextRunAt,
      missedRunPolicy: "run_latest",
      overlapPolicy: "allow_parallel",
    });
    return { repos, schedule };
  }

  test("tick triggers due schedules when lease is held", async () => {
    const dueAt = "2026-01-01T01:00:00.000Z";
    const { schedule } = setupSchedule(dueAt);
    const triggers: Array<{ scheduleId: string; fireAt: Date }> = [];

    const scheduler = new Scheduler({
      db: db!,
      leaseHolderId: "node-a",
      onTrigger: async (scheduleId, fireAt) => {
        triggers.push({ scheduleId, fireAt });
      },
    });

    expect(await scheduler.acquireLease(60_000)).toBe(true);
    await scheduler.tick(new Date("2026-01-01T01:05:00.000Z"));

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.scheduleId).toBe(schedule.id);
    expect(triggers[0]?.fireAt.toISOString()).toBe(dueAt);

    const updated = createRepositories(db!).schedules.findById(schedule.id);
    expect(updated?.lastRunAt).toBe(dueAt);
    expect(updated?.nextRunAt).toBe("2026-01-01T02:00:00.000Z");
  });

  test("tick does nothing without lease", async () => {
    setupSchedule("2026-01-01T01:00:00.000Z");
    let called = false;

    const schedulerA = new Scheduler({
      db: db!,
      leaseHolderId: "node-a",
      onTrigger: async () => {
        called = true;
      },
    });
    const schedulerB = new Scheduler({
      db: db!,
      leaseHolderId: "node-b",
      onTrigger: async () => {
        called = true;
      },
    });

    expect(await schedulerA.acquireLease(60_000)).toBe(true);
    expect(await schedulerB.acquireLease(60_000)).toBe(false);
    await schedulerB.tick(new Date("2026-01-01T01:05:00.000Z"));

    expect(called).toBe(false);
  });

  test("tick respects instance pause", async () => {
    setupSchedule("2026-01-01T01:00:00.000Z");
    db!
      .connection()
      .query("INSERT INTO instance_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
      .run("paused", JSON.stringify(true), new Date().toISOString());

    let called = false;
    const scheduler = new Scheduler({
      db: db!,
      leaseHolderId: "node-a",
      onTrigger: async () => {
        called = true;
      },
    });

    expect(await scheduler.acquireLease(60_000)).toBe(true);
    await scheduler.tick(new Date("2026-01-01T01:05:00.000Z"));
    expect(called).toBe(false);
  });

  test("tick skips overlapping runs with skip policy", async () => {
    const dueAt = "2026-01-01T01:00:00.000Z";
    const { repos, schedule } = setupSchedule(dueAt);
    repos.schedules.update(schedule.id, { overlapPolicy: "skip" });

    const project = repos.projects.list()[0]!;
    const task = repos.agents.listByProject(project.id)[0]!;
    repos.runs.create({
      projectId: project.id,
      agentId: task.id,
      scheduleId: schedule.id,
      idempotencyKey: "active-run",
      trigger: "schedule",
      state: RunState.Running,
    });

    let called = false;
    const scheduler = new Scheduler({
      db: db!,
      leaseHolderId: "node-a",
      onTrigger: async () => {
        called = true;
      },
    });

    expect(await scheduler.acquireLease(60_000)).toBe(true);
    await scheduler.tick(new Date("2026-01-01T01:05:00.000Z"));
    expect(called).toBe(false);
  });

  test("tick enqueues with queue overlap policy while a run is active", async () => {
    const dueAt = "2026-01-01T01:00:00.000Z";
    const { repos, schedule } = setupSchedule(dueAt);
    repos.schedules.update(schedule.id, { overlapPolicy: "queue" });

    const project = repos.projects.list()[0]!;
    const task = repos.agents.listByProject(project.id)[0]!;
    repos.runs.create({
      projectId: project.id,
      agentId: task.id,
      scheduleId: schedule.id,
      idempotencyKey: "active-run",
      trigger: "schedule",
      state: RunState.Running,
    });

    const triggers: string[] = [];
    const scheduler = new Scheduler({
      db: db!,
      leaseHolderId: "node-a",
      onTrigger: async (scheduleId) => {
        triggers.push(scheduleId);
      },
    });

    expect(await scheduler.acquireLease(60_000)).toBe(true);
    await scheduler.tick(new Date("2026-01-01T01:05:00.000Z"));
    expect(triggers).toEqual([schedule.id]);
  });

  test("tick cancel_replace cancels active run then triggers", async () => {
    const dueAt = "2026-01-01T01:00:00.000Z";
    const { repos, schedule } = setupSchedule(dueAt);
    repos.schedules.update(schedule.id, { overlapPolicy: "cancel_replace" });

    const project = repos.projects.list()[0]!;
    const task = repos.agents.listByProject(project.id)[0]!;
    repos.runs.create({
      projectId: project.id,
      agentId: task.id,
      scheduleId: schedule.id,
      idempotencyKey: "active-run",
      trigger: "schedule",
      state: RunState.Running,
    });

    const cancelled: string[] = [];
    const triggers: string[] = [];
    const scheduler = new Scheduler({
      db: db!,
      leaseHolderId: "node-a",
      onCancelActive: async (scheduleId) => {
        cancelled.push(scheduleId);
      },
      onTrigger: async (scheduleId) => {
        triggers.push(scheduleId);
      },
    });

    expect(await scheduler.acquireLease(60_000)).toBe(true);
    await scheduler.tick(new Date("2026-01-01T01:05:00.000Z"));
    expect(cancelled).toEqual([schedule.id]);
    expect(triggers).toEqual([schedule.id]);
  });

  test("start and stop manage lease lifecycle", async () => {
    setupSchedule("2026-01-01T01:00:00.000Z");
    const scheduler = new Scheduler({
      db: db!,
      leaseHolderId: "node-a",
      tickIntervalMs: 10_000,
      onTrigger: async () => {},
    });

    await scheduler.start();
    const row = db!
      .connection()
      .query<{ holder: string }, [string]>("SELECT holder FROM scheduler_leases WHERE id = ?")
      .get("primary");
    expect(row?.holder).toBe("node-a");

    await scheduler.stop();
    const after = db!
      .connection()
      .query<{ holder: string }, [string]>("SELECT holder FROM scheduler_leases WHERE id = ?")
      .get("primary");
    expect(after).toBeNull();
  });
});
