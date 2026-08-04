import { describe, expect, test } from "bun:test";

import { createRepositories } from "@/platform/create-repositories";
import { Database } from "@/infrastructure/persistence";
import { AppContextDashboardReadModel } from "@/contexts/operations/infrastructure/app-context-dashboard";
import type { AppContext } from "@/platform/app-context";

describe("operations/dashboard summary", () => {
  test("reports enabled inventory counts separately from totals", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const on = repos.projects.create({
      name: "on",
      repoPath: "/tmp/on",
      enabled: true,
    });
    repos.projects.create({
      name: "off",
      repoPath: "/tmp/off",
      enabled: false,
    });
    const enabledAgent = repos.agents.create({
      projectId: on.id,
      name: "keep",
      prompt: "keep",
      enabled: true,
    });
    repos.agents.create({
      projectId: on.id,
      name: "drop",
      prompt: "drop",
      enabled: false,
    });
    repos.schedules.create({
      agentId: enabledAgent.id,
      name: "daily",
      cronExpr: "0 9 * * *",
      enabled: true,
    });
    repos.schedules.create({
      agentId: enabledAgent.id,
      name: "paused",
      cronExpr: "0 10 * * *",
      enabled: false,
    });

    const reads = new AppContextDashboardReadModel({
      db,
      repos,
      isPaused: () => false,
    } as unknown as AppContext);

    expect(reads.summary("24h")).toMatchObject({
      projects: 2,
      enabledProjects: 1,
      agents: 2,
      enabledAgents: 1,
      schedules: 2,
      enabledSchedules: 1,
    });
    db.close();
  });
});
