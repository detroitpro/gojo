import { afterEach, describe, expect, mock, test } from "bun:test";

import { setSchedulingPolicy } from "@/infrastructure/persistence/instance-settings";
import { RunDispatcher } from "@/contexts/execution/application/dispatcher";
import type { RunCoordinator } from "@/contexts/execution/infrastructure/coordinator";
import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from "@/infrastructure/persistence";
import { RunState } from "@shared/run-states";

describe("runs/dispatcher", () => {
  let db: Database | null = null;

  afterEach(async () => {
    db?.close();
    db = null;
  });

  function setup() {
    db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    setSchedulingPolicy(db, {
      maxConcurrentRuns: 2,
      maxConcurrentRunsPerProject: 1,
      minStartIntervalMs: 0,
      maxLoadPerCpu: 0,
    });

    const projectA = repos.projects.create({ name: "a", repoPath: "/tmp/a" });
    const projectB = repos.projects.create({ name: "b", repoPath: "/tmp/b" });
    const taskA = repos.agents.create({ projectId: projectA.id, name: "ta", prompt: "go" });
    const taskB = repos.agents.create({ projectId: projectB.id, name: "tb", prompt: "go" });

    return { repos, projectA, projectB, taskA, taskB };
  }

  test("tick admits queued runs and calls executeRun", async () => {
    const { repos, projectA, projectB, taskA, taskB } = setup();
    const executed: string[] = [];
    const coordinator = {
      executeRun: mock(async (runId: string) => {
        executed.push(runId);
        repos.runs.update(runId, {
          state: RunState.Running,
          startedAt: new Date().toISOString(),
        });
        return repos.runs.findById(runId)!;
      }),
    } as unknown as RunCoordinator;

    const runA = repos.runs.create({
      projectId: projectA.id,
      agentId: taskA.id,
      idempotencyKey: "run-a",
      trigger: "manual",
      state: RunState.Queued,
      priority: 10,
      notBeforeAt: "2026-07-26T00:00:00.000Z",
    });
    const runB = repos.runs.create({
      projectId: projectB.id,
      agentId: taskB.id,
      idempotencyKey: "run-b",
      trigger: "schedule",
      state: RunState.Queued,
      priority: 30,
      notBeforeAt: "2026-07-26T00:00:00.000Z",
    });

    const dispatcher = new RunDispatcher({
      db: db!,
      coordinator,
      loadPerCpu: () => 0,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    const result = await dispatcher.tick();
    expect(result.admitted).toEqual([runA.id, runB.id]);
    expect(executed).toEqual([runA.id, runB.id]);
    expect(repos.runs.findById(runA.id)?.admittedAt).toBe("2026-07-26T12:00:00.000Z");
  });

  test("tick expires stale queued runs as Skipped", async () => {
    const { repos, projectA, taskA } = setup();
    const coordinator = {
      executeRun: mock(async () => {
        throw new Error("should not execute expired runs");
      }),
      syncWorkFromRun: mock(() => {}),
    } as unknown as RunCoordinator;

    const expired = repos.runs.create({
      projectId: projectA.id,
      agentId: taskA.id,
      idempotencyKey: "expired-run",
      trigger: "schedule",
      state: RunState.Queued,
      priority: 30,
      notBeforeAt: "2026-07-26T00:00:00.000Z",
      expiresAt: "2026-07-26T01:00:00.000Z",
    });

    const dispatcher = new RunDispatcher({
      db: db!,
      coordinator,
      loadPerCpu: () => 0,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    const result = await dispatcher.tick();
    expect(result.expired).toEqual([expired.id]);
    expect(result.admitted).toEqual([]);
    const run = repos.runs.findById(expired.id);
    expect(run?.state).toBe(RunState.Skipped);
    expect(run?.errorMessage).toContain("Expired waiting");
  });

  test("respects global concurrency against already-running runs", async () => {
    const { repos, projectA, projectB, taskA, taskB } = setup();
    const projectC = repos.projects.create({ name: "c", repoPath: "/tmp/c" });
    const taskC = repos.agents.create({ projectId: projectC.id, name: "tc", prompt: "go" });

    repos.runs.create({
      projectId: projectA.id,
      agentId: taskA.id,
      idempotencyKey: "running-a",
      trigger: "manual",
      state: RunState.Running,
      priority: 10,
    });
    repos.runs.create({
      projectId: projectB.id,
      agentId: taskB.id,
      idempotencyKey: "running-b",
      trigger: "manual",
      state: RunState.Running,
      priority: 10,
    });
    const waiting = repos.runs.create({
      projectId: projectC.id,
      agentId: taskC.id,
      idempotencyKey: "waiting-c",
      trigger: "manual",
      state: RunState.Queued,
      priority: 10,
      notBeforeAt: "2026-07-26T00:00:00.000Z",
    });

    const executed: string[] = [];
    const coordinator = {
      executeRun: mock(async (runId: string) => {
        executed.push(runId);
        return repos.runs.findById(runId)!;
      }),
    } as unknown as RunCoordinator;

    const dispatcher = new RunDispatcher({
      db: db!,
      coordinator,
      loadPerCpu: () => 0,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    const result = await dispatcher.tick();
    expect(result.admitted).toEqual([]);
    expect(executed).toEqual([]);
    expect(repos.runs.findById(waiting.id)?.state).toBe(RunState.Queued);
  });

  test("tick coalesces when already ticking", async () => {
    const { repos, projectA, taskA } = setup();
    const run = repos.runs.create({
      projectId: projectA.id,
      agentId: taskA.id,
      idempotencyKey: "coalesce-run",
      trigger: "manual",
      state: RunState.Queued,
      priority: 10,
      notBeforeAt: "2026-07-26T00:00:00.000Z",
    });

    let releaseExecute: () => void = () => {};
    const executeGate = new Promise<void>((resolve) => {
      releaseExecute = resolve;
    });
    const coordinator = {
      executeRun: mock(async (runId: string) => {
        await executeGate;
        repos.runs.update(runId, {
          state: RunState.Running,
          startedAt: new Date().toISOString(),
        });
        return repos.runs.findById(runId)!;
      }),
    } as unknown as RunCoordinator;

    const dispatcher = new RunDispatcher({
      db: db!,
      coordinator,
      loadPerCpu: () => 0,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    const firstTick = dispatcher.tick();
    const secondResult = await dispatcher.tick();
    expect(secondResult).toEqual({ admitted: [], expired: [] });

    releaseExecute();
    const firstResult = await firstTick;
    expect(firstResult.admitted).toEqual([run.id]);
  });

  test("start kicks initial admission tick", async () => {
    const { repos, projectA, taskA } = setup();
    const run = repos.runs.create({
      projectId: projectA.id,
      agentId: taskA.id,
      idempotencyKey: "start-run",
      trigger: "manual",
      state: RunState.Queued,
      priority: 10,
      notBeforeAt: "2026-07-26T00:00:00.000Z",
    });

    const executed: string[] = [];
    const coordinator = {
      executeRun: mock(async (runId: string) => {
        executed.push(runId);
        repos.runs.update(runId, {
          state: RunState.Running,
          startedAt: new Date().toISOString(),
        });
        return repos.runs.findById(runId)!;
      }),
    } as unknown as RunCoordinator;

    const dispatcher = new RunDispatcher({
      db: db!,
      coordinator,
      tickIntervalMs: 60_000,
      loadPerCpu: () => 0,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    dispatcher.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(executed).toEqual([run.id]);
    await dispatcher.stop();
  });

  test("kick does not admit runs before the dispatcher starts", async () => {
    const { repos, projectA, taskA } = setup();
    repos.runs.create({
      projectId: projectA.id,
      agentId: taskA.id,
      idempotencyKey: "queued-before-start",
      trigger: "manual",
      state: RunState.Queued,
      priority: 10,
      notBeforeAt: "2026-07-26T00:00:00.000Z",
    });
    const executed: string[] = [];
    const coordinator = {
      executeRun: mock(async (runId: string) => {
        executed.push(runId);
        return repos.runs.findById(runId)!;
      }),
    } as unknown as RunCoordinator;
    const dispatcher = new RunDispatcher({
      db: db!,
      coordinator,
      loadPerCpu: () => 0,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    dispatcher.kick();
    await Promise.resolve();
    await Promise.resolve();

    expect(executed).toEqual([]);
  });

  test("admitted Scheduled run transitions to Queued", async () => {
    const { repos, projectA, taskA } = setup();
    const scheduled = repos.runs.create({
      projectId: projectA.id,
      agentId: taskA.id,
      idempotencyKey: "scheduled-run",
      trigger: "schedule",
      state: RunState.Scheduled,
      priority: 30,
      notBeforeAt: "2026-07-26T00:00:00.000Z",
    });

    let releaseExecute: () => void = () => {};
    const executeGate = new Promise<void>((resolve) => {
      releaseExecute = resolve;
    });
    const coordinator = {
      executeRun: mock(async (runId: string) => {
        await executeGate;
        repos.runs.update(runId, {
          state: RunState.Running,
          startedAt: new Date().toISOString(),
        });
        return repos.runs.findById(runId)!;
      }),
    } as unknown as RunCoordinator;

    const dispatcher = new RunDispatcher({
      db: db!,
      coordinator,
      loadPerCpu: () => 0,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });

    const result = await dispatcher.tick();
    expect(result.admitted).toEqual([scheduled.id]);
    expect(repos.runs.findById(scheduled.id)?.state).toBe(RunState.Queued);

    releaseExecute();
    await executeGate;
  });
});
