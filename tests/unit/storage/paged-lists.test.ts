import { describe, expect, test } from "bun:test";

import { Database, createRepositories } from "@/storage";
import {
  listOpenIntegrationsPage,
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

  test("listRunsPage sorts by whitelist columns", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const taskA = repos.tasks.create({ projectId: project.id, name: "alpha", prompt: "a" });
    const taskB = repos.tasks.create({ projectId: project.id, name: "beta", prompt: "b" });
    repos.runs.create({
      projectId: project.id,
      taskId: taskB.id,
      idempotencyKey: "b",
      trigger: "manual",
      state: RunState.Queued,
    });
    repos.runs.create({
      projectId: project.id,
      taskId: taskA.id,
      idempotencyKey: "a",
      trigger: "manual",
      state: RunState.Queued,
    });

    const asc = listRunsPage(db, {
      limit: 10,
      offset: 0,
      sort: "taskName",
      order: "asc",
    });
    expect(asc.items.map((run) => run.taskName)).toEqual(["alpha", "beta"]);

    const desc = listRunsPage(db, {
      limit: 10,
      offset: 0,
      sort: "taskName",
      order: "desc",
    });
    expect(desc.items.map((run) => run.taskName)).toEqual(["beta", "alpha"]);

    const fallback = listRunsPage(db, {
      limit: 10,
      offset: 0,
      sort: "not-a-column",
      order: "asc",
    });
    expect(fallback.items).toHaveLength(2);

    db.close();
  });

  test("listProjectsPage and listTasksPage honor sort", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    repos.projects.create({ name: "zeta", repoPath: "/tmp/z" });
    const alpha = repos.projects.create({ name: "alpha", repoPath: "/tmp/a" });
    repos.tasks.create({ projectId: alpha.id, name: "z-task", prompt: "z" });
    repos.tasks.create({ projectId: alpha.id, name: "a-task", prompt: "a" });

    const projects = listProjectsPage(db, {
      limit: 10,
      offset: 0,
      sort: "name",
      order: "asc",
    });
    expect(projects.items.map((p) => p.name)).toEqual(["alpha", "zeta"]);

    const tasks = listTasksPage(db, {
      limit: 10,
      offset: 0,
      projectId: alpha.id,
      sort: "name",
      order: "asc",
    });
    expect(tasks.items.map((t) => t.name)).toEqual(["a-task", "z-task"]);

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
      openPrCount: 0,
    });

    db.close();
  });

  test("open integrations: count, page, filter, and hasOpenPrs", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const withOpen = repos.projects.create({ name: "with-open", repoPath: "/tmp/a" });
    const without = repos.projects.create({ name: "without", repoPath: "/tmp/b" });
    const taskA = repos.tasks.create({
      projectId: withOpen.id,
      name: "maintain-quality",
      prompt: "a",
    });
    const taskB = repos.tasks.create({
      projectId: withOpen.id,
      name: "maintain-docs",
      prompt: "b",
    });
    const taskC = repos.tasks.create({
      projectId: without.id,
      name: "other",
      prompt: "c",
    });

    const runOld = repos.runs.create({
      projectId: withOpen.id,
      taskId: taskA.id,
      idempotencyKey: "old",
      trigger: "manual",
    });
    const runNew = repos.runs.create({
      projectId: withOpen.id,
      taskId: taskB.id,
      idempotencyKey: "new",
      trigger: "manual",
    });
    const runMerged = repos.runs.create({
      projectId: withOpen.id,
      taskId: taskA.id,
      idempotencyKey: "merged",
      trigger: "manual",
    });
    const runOther = repos.runs.create({
      projectId: without.id,
      taskId: taskC.id,
      idempotencyKey: "other",
      trigger: "manual",
    });

    repos.attempts.create({
      runId: runNew.id,
      attemptNumber: 1,
      branchName: "gojo/maintain-docs/branch",
    });

    repos.runIntegrations.upsertForRun({
      runId: runOld.id,
      mode: "pull-request",
      provider: "github",
      repo: "me/a",
      prNumber: 1,
      prUrl: "https://github.com/me/a/pull/1",
      status: "open",
      openedAt: "2026-07-01T00:00:00.000Z",
    });
    repos.runIntegrations.upsertForRun({
      runId: runNew.id,
      mode: "pull-request",
      provider: "github",
      repo: "me/a",
      prNumber: 2,
      prUrl: "https://github.com/me/a/pull/2",
      status: "open",
      openedAt: "2026-07-10T00:00:00.000Z",
    });
    repos.runIntegrations.upsertForRun({
      runId: runMerged.id,
      mode: "pull-request",
      provider: "github",
      repo: "me/a",
      prNumber: 3,
      prUrl: "https://github.com/me/a/pull/3",
      status: "merged",
      openedAt: "2026-07-05T00:00:00.000Z",
      mergedAt: "2026-07-06T00:00:00.000Z",
    });
    repos.runIntegrations.upsertForRun({
      runId: runOther.id,
      mode: "pull-request",
      provider: "github",
      repo: "me/b",
      prNumber: 9,
      prUrl: "https://github.com/me/b/pull/9",
      status: "closed",
      openedAt: "2026-07-02T00:00:00.000Z",
      closedAt: "2026-07-03T00:00:00.000Z",
    });

    expect(projectSummaryFor(db, withOpen.id)?.openPrCount).toBe(2);
    expect(projectSummaryFor(db, without.id)?.openPrCount).toBe(0);

    const allOpen = listOpenIntegrationsPage(db, { limit: 25, offset: 0 });
    expect(allOpen.total).toBe(2);
    expect(allOpen.items.map((row) => row.prNumber)).toEqual([2, 1]);
    expect(allOpen.items[0]?.branchName).toBe("gojo/maintain-docs/branch");
    expect(allOpen.items[0]?.projectName).toBe("with-open");
    expect(allOpen.items[0]?.taskName).toBe("maintain-docs");

    const filtered = listOpenIntegrationsPage(db, {
      limit: 25,
      offset: 0,
      projectId: withOpen.id,
    });
    expect(filtered.total).toBe(2);

    const page = listOpenIntegrationsPage(db, {
      limit: 1,
      offset: 0,
      sort: "openedAt",
      order: "asc",
    });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.prNumber).toBe(1);

    const withPrs = listProjectsPage(db, { limit: 25, offset: 0, hasOpenPrs: true });
    expect(withPrs.total).toBe(1);
    expect(withPrs.items[0]?.id).toBe(withOpen.id);
    expect(withPrs.items[0]?.openPrCount).toBe(2);

    db.close();
  });
});

