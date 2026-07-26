import { describe, expect, test } from "bun:test";

import { RunState } from "@shared/run-states";
import { Database, createRepositories } from "@/storage";
import { listTasksPage } from "@/storage/paged-lists";

describe("listTasksPage recentRuns", () => {
  test("attaches up to 5 recent runs oldest-to-newest per page task", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);

    const project = repos.projects.create({ name: "alpha", repoPath: "/tmp/alpha" });
    const withRuns = repos.tasks.create({
      projectId: project.id,
      name: "with-runs",
      prompt: "a",
    });
    const empty = repos.tasks.create({
      projectId: project.id,
      name: "empty",
      prompt: "b",
    });

    for (let i = 0; i < 7; i += 1) {
      const run = repos.runs.create({
        projectId: project.id,
        taskId: withRuns.id,
        idempotencyKey: `r-${i}`,
        trigger: i < 2 ? "schedule" : "manual",
        state: i % 2 === 0 ? RunState.Succeeded : RunState.Failed,
      });
      db.connection()
        .query("UPDATE runs SET created_at = ? WHERE id = ?")
        .run(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, run.id);
    }

    const page = listTasksPage(db, { limit: 50, offset: 0 });
    expect(page.items).toHaveLength(2);

    const emptyRow = page.items.find((task) => task.id === empty.id);
    expect(emptyRow?.recentRuns).toEqual([]);

    const busy = page.items.find((task) => task.id === withRuns.id);
    expect(busy?.recentRuns).toHaveLength(5);
    expect(busy?.recentRuns.map((run) => run.createdAt)).toEqual([
      "2026-01-03T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z",
      "2026-01-05T00:00:00.000Z",
      "2026-01-06T00:00:00.000Z",
      "2026-01-07T00:00:00.000Z",
    ]);
    expect(busy?.recentRuns[0]?.trigger).toBe("manual");
    expect(busy?.recentRuns.at(-1)?.state).toBe(RunState.Succeeded);
    expect(busy?.lastRunId).toBe(busy?.recentRuns.at(-1)?.id);

    db.close();
  });
});
