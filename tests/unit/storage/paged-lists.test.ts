import { describe, expect, test } from "bun:test";

import { Database, createRepositories } from "@/storage";
import {
  listProjectsPage,
  listRunsPage,
  listTasksPage,
  projectSummaryFor,
} from "@/storage/paged-lists";
import { RunState } from "@shared/run-states";

describe("paged-lists", () => {
  test("listRunsPage filters and pages", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const other = repos.projects.create({ name: "other", repoPath: "/tmp/other" });
    const task = repos.tasks.create({
      projectId: project.id,
      name: "maintain-quality",
      prompt: "work",
    });
    const task2 = repos.tasks.create({
      projectId: other.id,
      name: "deps",
      prompt: "work",
    });

    for (let i = 0; i < 3; i += 1) {
      repos.runs.create({
        projectId: project.id,
        taskId: task.id,
        idempotencyKey: `k-${i}`,
        trigger: "schedule",
        state: RunState.Failed,
      });
    }
    repos.runs.create({
      projectId: other.id,
      taskId: task2.id,
      idempotencyKey: "other",
      trigger: "manual",
      state: RunState.Succeeded,
    });

    const page = listRunsPage(db, {
      limit: 2,
      offset: 0,
      projectId: project.id,
      state: RunState.Failed,
      q: "quality",
    });

    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.items.every((run) => run.projectId === project.id)).toBe(true);
    expect(page.items[0]?.taskName).toBe("maintain-quality");

    db.close();
  });

  test("listTasksPage respects enabled filter", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    repos.tasks.create({
      projectId: project.id,
      name: "on",
      prompt: "a",
      enabled: true,
    });
    repos.tasks.create({
      projectId: project.id,
      name: "off",
      prompt: "b",
      enabled: false,
    });

    const enabled = listTasksPage(db, { limit: 25, offset: 0, enabled: true });
    expect(enabled.total).toBe(1);
    expect(enabled.items[0]?.name).toBe("on");

    db.close();
  });

  test("listRunsPage filters by taskId", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const taskA = repos.tasks.create({
      projectId: project.id,
      name: "task-a",
      prompt: "a",
    });
    const taskB = repos.tasks.create({
      projectId: project.id,
      name: "task-b",
      prompt: "b",
    });
    repos.runs.create({
      projectId: project.id,
      taskId: taskA.id,
      idempotencyKey: "a1",
      trigger: "manual",
      state: RunState.Succeeded,
    });
    repos.runs.create({
      projectId: project.id,
      taskId: taskB.id,
      idempotencyKey: "b1",
      trigger: "manual",
      state: RunState.Failed,
    });

    const page = listRunsPage(db, { limit: 25, offset: 0, taskId: taskA.id });
    expect(page.total).toBe(1);
    expect(page.items[0]?.taskId).toBe(taskA.id);
    expect(page.items[0]?.taskName).toBe("task-a");

    db.close();
  });

  test("listTasksPage includes last-run fields", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const withRun = repos.tasks.create({
      projectId: project.id,
      name: "with-run",
      prompt: "a",
    });
    const without = repos.tasks.create({
      projectId: project.id,
      name: "without-run",
      prompt: "b",
    });
    const older = repos.runs.create({
      projectId: project.id,
      taskId: withRun.id,
      idempotencyKey: "older",
      trigger: "manual",
      state: RunState.Failed,
    });
    // Ensure newer created_at for latest-run pick.
    db.connection()
      .query("UPDATE runs SET created_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", older.id);
    const newer = repos.runs.create({
      projectId: project.id,
      taskId: withRun.id,
      idempotencyKey: "newer",
      trigger: "api",
      state: RunState.Succeeded,
    });

    const page = listTasksPage(db, { limit: 25, offset: 0 });
    const withRow = page.items.find((task) => task.id === withRun.id);
    const withoutRow = page.items.find((task) => task.id === without.id);

    expect(withRow?.lastRunId).toBe(newer.id);
    expect(withRow?.lastRunState).toBe(RunState.Succeeded);
    expect(withRow?.lastRunCreatedAt).toBeTruthy();
    expect(withoutRow?.lastRunId).toBeNull();
    expect(withoutRow?.lastRunState).toBeNull();
    expect(withoutRow?.lastRunCreatedAt).toBeNull();

    db.close();
  });

  test("listProjectsPage includes task/schedule summary and omits manifestJson", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
      manifestJson: '{"version":1,"tasks":{}}',
    });
    const empty = repos.projects.create({ name: "empty", repoPath: "/tmp/empty" });
    const on = repos.tasks.create({
      projectId: project.id,
      name: "on",
      prompt: "a",
      enabled: true,
    });
    repos.tasks.create({
      projectId: project.id,
      name: "off",
      prompt: "b",
      enabled: false,
    });
    repos.schedules.create({
      taskId: on.id,
      name: "on",
      cronExpr: "0 1 * * *",
      enabled: true,
    });
    repos.schedules.create({
      taskId: on.id,
      name: "off-sched",
      cronExpr: "0 2 * * *",
      enabled: false,
    });

    const page = listProjectsPage(db, { limit: 25, offset: 0 });
    const demo = page.items.find((row) => row.id === project.id);
    const bare = page.items.find((row) => row.id === empty.id);

    expect(demo?.taskCount).toBe(2);
    expect(demo?.enabledTaskCount).toBe(1);
    expect(demo?.scheduleCount).toBe(2);
    expect(demo?.enabledScheduleCount).toBe(1);
    expect(demo?.hasManifest).toBe(true);
    expect(demo?.manifestJson).toBeUndefined();

    expect(bare?.taskCount).toBe(0);
    expect(bare?.hasManifest).toBe(false);

    const summary = projectSummaryFor(db, project.id);
    expect(summary).toEqual({
      taskCount: 2,
      enabledTaskCount: 1,
      scheduleCount: 2,
      enabledScheduleCount: 1,
      hasManifest: true,
    });

    db.close();
  });
});

