import { describe, expect, test } from "bun:test";

import { getDashboardOverview } from "@/contexts/operations/infrastructure/dashboard-overview";
import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from "@/infrastructure/persistence";
import { RunState } from "@shared/run-states";

describe("storage/dashboard-overview", () => {
  test("groups enabled agents by project with last 5 runs oldest-to-newest", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);

    const alpha = repos.projects.create({ name: "alpha", repoPath: "/tmp/alpha" });
    const beta = repos.projects.create({ name: "beta", repoPath: "/tmp/beta" });

    const agentA = repos.agents.create({
      projectId: alpha.id,
      name: "maintain-a",
      prompt: "a",
      description: "Alpha agent",
      enabled: true,
    });
    repos.agents.create({
      projectId: alpha.id,
      name: "disabled-a",
      prompt: "x",
      enabled: false,
    });
    const agentB = repos.agents.create({
      projectId: beta.id,
      name: "maintain-b",
      prompt: "b",
      enabled: true,
    });

    // 0 runs for agentB; 3 for agentA; then add more to exceed 5
    for (let i = 0; i < 3; i += 1) {
      const run = repos.runs.create({
        projectId: alpha.id,
        agentId: agentA.id,
        idempotencyKey: `a-${i}`,
        trigger: "schedule",
        state: i === 2 ? RunState.Succeeded : RunState.Failed,
      });
      db.connection()
        .query("UPDATE runs SET created_at = ? WHERE id = ?")
        .run(`2026-01-0${i + 1}T00:00:00.000Z`, run.id);
    }
    for (let i = 3; i < 7; i += 1) {
      const run = repos.runs.create({
        projectId: alpha.id,
        agentId: agentA.id,
        idempotencyKey: `a-${i}`,
        trigger: "manual",
        state: RunState.Succeeded,
      });
      db.connection()
        .query("UPDATE runs SET created_at = ? WHERE id = ?")
        .run(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, run.id);
    }

    const overview = getDashboardOverview(db);
    expect(overview.projects.map((p) => p.name)).toEqual(["alpha", "beta"]);

    const alphaAgents = overview.projects[0]?.agents ?? [];
    expect(alphaAgents).toHaveLength(1);
    expect(alphaAgents[0]?.name).toBe("maintain-a");
    expect(alphaAgents[0]?.description).toBe("Alpha agent");
    expect(alphaAgents[0]?.recentRuns).toHaveLength(5);
    // Oldest → newest among the last 5 (Jan 3..7), newest last
    expect(alphaAgents[0]?.recentRuns.map((r) => r.createdAt)).toEqual([
      "2026-01-03T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z",
      "2026-01-05T00:00:00.000Z",
      "2026-01-06T00:00:00.000Z",
      "2026-01-07T00:00:00.000Z",
    ]);
    // Jan 3 was Succeeded (i===2); Jan 4–7 are Succeeded manual
    expect(alphaAgents[0]?.recentRuns[0]?.state).toBe(RunState.Succeeded);
    expect(alphaAgents[0]?.recentRuns[0]?.trigger).toBe("schedule");
    expect(alphaAgents[0]?.recentRuns[4]?.trigger).toBe("manual");

    const betaAgents = overview.projects[1]?.agents ?? [];
    expect(betaAgents).toHaveLength(1);
    expect(betaAgents[0]?.id).toBe(agentB.id);
    expect(betaAgents[0]?.recentRuns).toEqual([]);

    db.close();
  });

  test("includes projects with no enabled agents", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    repos.projects.create({ name: "lonely", repoPath: "/tmp/lonely" });

    const overview = getDashboardOverview(db);
    expect(overview.projects).toHaveLength(1);
    expect(overview.projects[0]?.agents).toEqual([]);

    db.close();
  });
});
