import { describe, expect, test } from "bun:test";

import { RunState } from "@shared/run-states";
import { Database, createRepositories } from "@/storage";
import { listAgentsPage } from "@/storage/paged-lists";

describe("listAgentsPage recentRuns", () => {
  test("attaches up to 5 recent runs oldest-to-newest per page agent", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);

    const project = repos.projects.create({ name: "alpha", repoPath: "/tmp/alpha" });
    const withRuns = repos.agents.create({
      projectId: project.id,
      name: "with-runs",
      prompt: "a",
    });
    const empty = repos.agents.create({
      projectId: project.id,
      name: "empty",
      prompt: "b",
    });

    for (let i = 0; i < 7; i += 1) {
      const run = repos.runs.create({
        projectId: project.id,
        agentId: withRuns.id,
        idempotencyKey: `r-${i}`,
        trigger: i < 2 ? "schedule" : "manual",
        state: i % 2 === 0 ? RunState.Succeeded : RunState.Failed,
      });
      db.connection()
        .query("UPDATE runs SET created_at = ? WHERE id = ?")
        .run(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, run.id);
    }

    const page = listAgentsPage(db, { limit: 50, offset: 0 });
    expect(page.items).toHaveLength(2);

    const emptyRow = page.items.find((agent) => agent.id === empty.id);
    expect(emptyRow?.recentRuns).toEqual([]);

    const busy = page.items.find((agent) => agent.id === withRuns.id);
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

  test("sorts by successRate over the last 5 runs (nulls last)", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);

    const project = repos.projects.create({ name: "ops", repoPath: "/tmp/ops" });
    const healthy = repos.agents.create({
      projectId: project.id,
      name: "healthy",
      prompt: "ok",
    });
    const flaky = repos.agents.create({
      projectId: project.id,
      name: "flaky",
      prompt: "maybe",
    });
    const broken = repos.agents.create({
      projectId: project.id,
      name: "broken",
      prompt: "no",
    });
    repos.agents.create({
      projectId: project.id,
      name: "idle",
      prompt: "never",
    });

    // healthy: 5/5 succeeded
    for (let i = 0; i < 5; i += 1) {
      repos.runs.create({
        projectId: project.id,
        agentId: healthy.id,
        idempotencyKey: `h-${i}`,
        trigger: "manual",
        state: RunState.Succeeded,
      });
    }
    // flaky: 2/4 succeeded (50%)
    for (let i = 0; i < 4; i += 1) {
      repos.runs.create({
        projectId: project.id,
        agentId: flaky.id,
        idempotencyKey: `f-${i}`,
        trigger: "manual",
        state: i < 2 ? RunState.Succeeded : RunState.Failed,
      });
    }
    // broken: 0/3 succeeded
    for (let i = 0; i < 3; i += 1) {
      repos.runs.create({
        projectId: project.id,
        agentId: broken.id,
        idempotencyKey: `b-${i}`,
        trigger: "manual",
        state: RunState.Failed,
      });
    }

    const worstFirst = listAgentsPage(db, {
      limit: 50,
      offset: 0,
      sort: "successRate",
      order: "asc",
    });
    expect(worstFirst.items.map((agent) => agent.name)).toEqual([
      "broken",
      "flaky",
      "healthy",
      "idle",
    ]);

    const bestFirst = listAgentsPage(db, {
      limit: 50,
      offset: 0,
      sort: "successRate",
      order: "desc",
    });
    expect(bestFirst.items.map((agent) => agent.name)).toEqual([
      "healthy",
      "flaky",
      "broken",
      "idle",
    ]);

    db.close();
  });
});
