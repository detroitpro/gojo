import { describe, expect, test } from "bun:test";

import { FixedClock, InMemoryUnitOfWork } from "@/kernel";
import { browseFilesystemQuery } from "@/contexts/catalog/application/browse-filesystem";
import { deleteProjectCommand } from "@/contexts/catalog/application/delete-project";
import { setAgentEnabledCommand } from "@/contexts/catalog/application/set-agent-enabled";
import { setScheduleEnabledCommand } from "@/contexts/catalog/application/set-schedule-enabled";
import { syncProjectCommand } from "@/contexts/catalog/application/sync-project";
import { testAdapterCommand } from "@/contexts/catalog/application/test-adapter";
import type { AdapterRegistryPort } from "@/contexts/catalog/ports/adapter-registry";
import type { CatalogStore } from "@/contexts/catalog/ports/catalog-store";
import type { FilesystemBrowserPort } from "@/contexts/catalog/ports/filesystem-browser";
import type { Agent, Project, Schedule } from "@/infrastructure/persistence/types";

const notImplemented = (name: string) => () => {
  throw new Error(`CatalogStore.${name} not implemented in stub`);
};

/**
 * Build a CatalogStore whose methods throw unless explicitly overridden.
 * Encourages tests to state which surface they exercise.
 */
function stubStore(over: Partial<CatalogStore>): CatalogStore {
  const base = {
    listProjects: notImplemented("listProjects"),
    findProject: notImplemented("findProject"),
    toProjectDetail: notImplemented("toProjectDetail"),
    deleteProject: notImplemented("deleteProject"),
    syncProjectFromManifest: notImplemented("syncProjectFromManifest"),
    ensureProjectRepositorySource: notImplemented("ensureProjectRepositorySource"),
    listAgents: notImplemented("listAgents"),
    findAgent: notImplemented("findAgent"),
    getAgentDetail: notImplemented("getAgentDetail"),
    updateAgentEnabled: notImplemented("updateAgentEnabled"),
    listSchedules: notImplemented("listSchedules"),
    findSchedule: notImplemented("findSchedule"),
    agentForSchedule: notImplemented("agentForSchedule"),
    updateScheduleEnabled: notImplemented("updateScheduleEnabled"),
    computeScheduleNextRun: notImplemented("computeScheduleNextRun"),
    listImpactItems: notImplemented("listImpactItems"),
    listIntegrations: notImplemented("listIntegrations"),
    listRuns: notImplemented("listRuns"),
  } as unknown as CatalogStore;
  return { ...base, ...over };
}

const clock = () => new FixedClock(new Date("2026-01-01T00:00:00.000Z"));

const project: Project = {
  id: "prj_1",
  name: "demo",
  repoPath: "/repo",
  remoteUrl: null,
  defaultBranch: "main",
  manifestJson: "{}",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const agent: Agent = {
  id: "agt_1",
  projectId: project.id,
  name: "hello",
  description: "hello agent",
  profileId: null,
  prompt: "run",
  validationProfileJson: "{}",
  integrationJson: "{}",
  failurePolicyJson: "{}",
  concurrencyJson: "{}",
  notificationsJson: "{}",
  environmentJson: "{}",
  triggerJson: "{}",
} as Agent;

const schedule: Schedule = {
  id: "sch_1",
  agentId: agent.id,
  name: "nightly",
  cronExpr: "0 3 * * *",
  timezone: "UTC",
  enabled: false,
  overlapPolicy: "skip",
  missedRunPolicy: "run-once",
  retryJson: "{}",
  consecutiveFailures: 0,
  disableAfter: null,
  nextRunAt: null,
  lastRunAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("contexts/catalog sync-project", () => {
  test("returns not_found when project does not exist", async () => {
    const store = stubStore({ findProject: () => null });
    const res = await syncProjectCommand(
      { store, clock: clock(), uow: new InMemoryUnitOfWork() },
      { projectId: "missing" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("not_found");
      expect(res.error.status).toBe(404);
    }
  });

  test("syncs and emits a single project.synced event", async () => {
    let synced = 0;
    let ensured = 0;
    const store = stubStore({
      findProject: () => project,
      syncProjectFromManifest: () => {
        synced += 1;
        return { agents: 1, profiles: 1 } as never;
      },
      ensureProjectRepositorySource: () => {
        ensured += 1;
      },
      toProjectDetail: () => ({ id: project.id, name: project.name }) as never,
    });
    const uow = new InMemoryUnitOfWork();
    const res = await syncProjectCommand(
      { store, clock: clock(), uow },
      { projectId: project.id },
    );
    expect(res.ok).toBe(true);
    expect(synced).toBe(1);
    expect(ensured).toBe(1);
    if (res.ok) {
      expect(res.value.events).toHaveLength(1);
      expect(res.value.events[0]?.type).toBe("project.synced");
      expect(res.value.events[0]?.topics).toEqual(
        expect.arrayContaining(["dashboard", "projects", "agents", "schedules"]),
      );
    }
  });

  test("still emits event when repository discovery throws", async () => {
    const store = stubStore({
      findProject: () => project,
      syncProjectFromManifest: () => ({ agents: 0, profiles: 0 }) as never,
      ensureProjectRepositorySource: () => {
        throw new Error("no remote");
      },
      toProjectDetail: () => ({ id: project.id, name: project.name }) as never,
    });
    const uow = new InMemoryUnitOfWork();
    const res = await syncProjectCommand(
      { store, clock: clock(), uow },
      { projectId: project.id },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.events).toHaveLength(1);
    }
  });
});

describe("contexts/catalog set-agent-enabled", () => {
  test("returns not_found when agent missing", async () => {
    const store = stubStore({ findAgent: () => null });
    const res = await setAgentEnabledCommand(
      { store, clock: clock(), uow: new InMemoryUnitOfWork() },
      { id: "missing", enabled: true },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not_found");
  });

  test("emits agent.updated with the requested enabled flag", async () => {
    const store = stubStore({
      findAgent: () => agent,
      updateAgentEnabled: (_id, enabled) => ({ ...agent, enabled } as unknown as Agent),
    });
    const uow = new InMemoryUnitOfWork();
    const res = await setAgentEnabledCommand(
      { store, clock: clock(), uow },
      { id: agent.id, enabled: false },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.events).toHaveLength(1);
      const event = res.value.events[0]!;
      expect(event.type).toBe("agent.updated");
      expect(event.entityId).toBe(agent.id);
      expect(event.projectId).toBe(agent.projectId);
      expect(event.data).toEqual({ enabled: false });
    }
  });
});

describe("contexts/catalog set-schedule-enabled", () => {
  test("returns not_found when schedule missing", async () => {
    const store = stubStore({ findSchedule: () => null });
    const res = await setScheduleEnabledCommand(
      { store, clock: clock(), uow: new InMemoryUnitOfWork() },
      { id: "missing", enabled: true },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not_found");
  });

  test("computes nextRunAt when enabling and skips computation when disabling", async () => {
    let computed = 0;
    const updateCalls: Array<{ enabled: boolean; nextRunAt?: string | null }> = [];
    const store = stubStore({
      findSchedule: () => schedule,
      agentForSchedule: () => agent,
      computeScheduleNextRun: () => {
        computed += 1;
        return "2026-01-02T03:00:00.000Z";
      },
      updateScheduleEnabled: (_id, enabled, nextRunAt) => {
        updateCalls.push({
          enabled,
          ...(nextRunAt !== undefined ? { nextRunAt } : {}),
        });
        return { ...schedule, enabled, nextRunAt: nextRunAt ?? null } as Schedule;
      },
    });
    const enable = await setScheduleEnabledCommand(
      { store, clock: clock(), uow: new InMemoryUnitOfWork() },
      { id: schedule.id, enabled: true },
    );
    expect(enable.ok).toBe(true);
    expect(computed).toBe(1);
    expect(updateCalls.at(-1)).toEqual({
      enabled: true,
      nextRunAt: "2026-01-02T03:00:00.000Z",
    });

    const disable = await setScheduleEnabledCommand(
      { store, clock: clock(), uow: new InMemoryUnitOfWork() },
      { id: schedule.id, enabled: false },
    );
    expect(disable.ok).toBe(true);
    expect(computed).toBe(1);
    expect(updateCalls.at(-1)).toEqual({ enabled: false });
  });
});

describe("contexts/catalog delete-project", () => {
  test("emits project.deleted only when a row was removed", async () => {
    const uow = new InMemoryUnitOfWork();
    const missing = await deleteProjectCommand(
      { store: stubStore({ deleteProject: () => false }), clock: clock(), uow },
      { id: "prj_missing" },
    );
    expect(missing.ok).toBe(true);
    if (missing.ok) {
      expect(missing.value.removed).toBe(false);
      expect(missing.value.events).toHaveLength(0);
    }

    const uow2 = new InMemoryUnitOfWork();
    const removed = await deleteProjectCommand(
      { store: stubStore({ deleteProject: () => true }), clock: clock(), uow: uow2 },
      { id: project.id },
    );
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.value.removed).toBe(true);
      expect(removed.value.events).toHaveLength(1);
      expect(removed.value.events[0]?.type).toBe("project.deleted");
    }
  });
});

describe("contexts/catalog test-adapter", () => {
  test("returns not_found when adapter unknown", async () => {
    const registry: AdapterRegistryPort = {
      list: () => [],
      find: () => undefined,
    };
    const res = await testAdapterCommand(registry, { name: "ghost" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not_found");
  });

  test("executes the adapter and forwards its result", async () => {
    let executed = 0;
    const adapter = {
      name: "shell",
      execute: async () => {
        executed += 1;
        return { exitCode: 0 } as unknown;
      },
    } as unknown as ReturnType<AdapterRegistryPort["list"]>[number];
    const registry: AdapterRegistryPort = {
      list: () => [adapter],
      find: () => adapter,
    };
    const res = await testAdapterCommand(registry, {
      name: "shell",
      prompt: "true",
      workspacePath: "/tmp",
      timeoutMs: 5_000,
    });
    expect(res.ok).toBe(true);
    expect(executed).toBe(1);
    if (res.ok) expect(res.value.result).toEqual({ exitCode: 0 });
  });
});

describe("contexts/catalog browse-filesystem", () => {
  test("returns listing and roots on success", async () => {
    const browser: FilesystemBrowserPort = {
      browse: () => ({ entries: [], path: "/repo" }) as never,
      roots: () => [{ label: "home", path: "/home" }],
    };
    const res = await browseFilesystemQuery(browser, { path: "/repo" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.roots).toEqual([{ label: "home", path: "/home" }]);
    }
  });

  test("maps thrown errors to validation_error", async () => {
    const browser: FilesystemBrowserPort = {
      browse: () => {
        throw new Error("outside roots");
      },
      roots: () => [],
    };
    const res = await browseFilesystemQuery(browser, { path: "/etc" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("validation_error");
      expect(res.error.status).toBe(400);
      expect(res.error.message).toContain("outside roots");
    }
  });
});
