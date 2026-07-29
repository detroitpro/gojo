import { afterEach, describe, expect, test } from "bun:test";

import { Database, createRepositories } from "@/storage";
import { recordRunOutcome, shouldDisableSchedule } from "@/storage/schedule-outcomes";

describe("storage/schedule-outcomes", () => {
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  function openDb(): Database {
    db = Database.open(":memory:");
    db.migrate();
    return db;
  }

  function createSchedule(disableAfter: number | null = 3) {
    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const task = repos.tasks.create({ projectId: project.id, name: "task", prompt: "go" });
    return repos.schedules.create({
      taskId: task.id,
      name: "nightly",
      cronExpr: "0 2 * * *",
      disableAfter,
    });
  }

  test("shouldDisableSchedule respects null threshold", () => {
    expect(shouldDisableSchedule(10, null)).toBe(false);
  });

  test("shouldDisableSchedule disables at threshold", () => {
    expect(shouldDisableSchedule(2, 3)).toBe(false);
    expect(shouldDisableSchedule(3, 3)).toBe(true);
  });

  test("recordRunOutcome resets failures on success", async () => {
    const schedule = createSchedule(3);
    const repos = createRepositories(db!);
    repos.schedules.incrementFailures(schedule.id);
    repos.schedules.incrementFailures(schedule.id);

    const result = await recordRunOutcome(db!, schedule.id, true);
    expect(result.disabled).toBe(false);
    expect(repos.schedules.findById(schedule.id)?.consecutiveFailures).toBe(0);
  });

  test("recordRunOutcome disables schedule after consecutive failures", async () => {
    const schedule = createSchedule(2);
    await recordRunOutcome(db!, schedule.id, false);
    const result = await recordRunOutcome(db!, schedule.id, false);

    expect(result.disabled).toBe(true);
    const updated = createRepositories(db!).schedules.findById(schedule.id);
    expect(updated?.enabled).toBe(false);
    expect(updated?.consecutiveFailures).toBe(2);
  });
});
