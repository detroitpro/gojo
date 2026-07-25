import { afterEach, describe, expect, test } from "bun:test";

import { listUpcomingSchedules } from "@/scheduler/upcoming";
import { Database, createRepositories } from "@/storage";

describe("listUpcomingSchedules", () => {
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

  function seed(enabled = true) {
    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const task = repos.tasks.create({ projectId: project.id, name: "task", prompt: "go" });
    const schedule = repos.schedules.create({
      taskId: task.id,
      name: "hourly",
      cronExpr: "0 * * * *",
      timezone: "UTC",
      enabled,
    });
    return { schedule };
  }

  test("returns fires clipped to horizon and stable colors", () => {
    const { schedule } = seed(true);
    const from = new Date("2026-01-01T00:30:00.000Z");
    const result = listUpcomingSchedules(db!, {
      horizonHours: 5,
      now: from,
      enabled: true,
    });

    expect(result.horizonHours).toBe(5);
    expect(result.schedules).toHaveLength(1);
    const series = result.schedules[0]!;
    expect(series.id).toBe(schedule.id);
    expect(series.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(series.fires.length).toBeGreaterThanOrEqual(4);
    expect(series.fires.length).toBeLessThanOrEqual(5);
    for (const fire of series.fires) {
      const ms = Date.parse(fire);
      expect(ms).toBeGreaterThan(from.getTime());
      expect(ms).toBeLessThanOrEqual(Date.parse(result.to));
    }
  });

  test("respects enabled filter", () => {
    seed(false);
    const onlyEnabled = listUpcomingSchedules(db!, {
      horizonHours: 24,
      enabled: true,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(onlyEnabled.schedules).toHaveLength(0);

    const all = listUpcomingSchedules(db!, {
      horizonHours: 24,
      enabled: null,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(all.schedules).toHaveLength(1);
    expect(all.schedules[0]!.enabled).toBe(false);
  });
});
