import { describe, expect, test } from "bun:test";

import { FixedClock, InMemoryUnitOfWork } from "@/kernel";
import { createProjectSourceCommand } from "@/contexts/work/application/create-project-source";
import { getProjectWorkStatusQuery } from "@/contexts/work/application/get-project-work-status";
import { getWorkItemDiffQuery } from "@/contexts/work/application/get-work-item-diff";
import { getWorkItemQuery } from "@/contexts/work/application/get-work-item";
import { recheckWorkItemCommand } from "@/contexts/work/application/recheck-work-item";
import { listProjectSourcesQuery } from "@/contexts/work/application/list-project-sources";
import { listProjectWorkQuery } from "@/contexts/work/application/list-project-work";
import { rebuildWorkStatusCommand } from "@/contexts/work/application/rebuild-work-status";
import { refreshProjectSourceCommand } from "@/contexts/work/application/refresh-project-source";
import { resolveWorkItemCommand } from "@/contexts/work/application/resolve-work-item";
import type {
  CreateProjectSourceCommand,
  ProjectSourceRow,
  WorkItemDetail,
  WorkStore,
} from "@/contexts/work/ports/work-store";
import type {
  ProjectSource,
  SourceConnection,
  WorkListInput,
  WorkPage,
} from "@/contexts/work/infrastructure/work-repositories";
import type {
  WorkItem,
  WorkRecheckResult,
  WorkResolveInput,
  WorkStatus,
} from "@shared/work";

function makeWorkPage(items: WorkItem[] = []): WorkPage {
  return { items, total: items.length, limit: 20, offset: 0 };
}

function makeWorkStatus(overrides: Partial<WorkStatus> = {}): WorkStatus {
  return {
    working: 0,
    queued: 0,
    needsAttention: 0,
    verifiedOpen: 0,
    staleOpen: 0,
    asOf: null,
    previous: null,
    previousAsOf: null,
    compareWindow: "24h",
    ...overrides,
  } as WorkStatus;
}

class MemoryWorkStore implements WorkStore {
  projects = new Set<string>();
  itemsByProject = new Map<string, WorkItem[]>();
  statuses = new Map<string, WorkStatus>();
  sources = new Map<string, ProjectSourceRow[]>();
  details = new Map<string, WorkItemDetail>();
  createdSources: CreateProjectSourceCommand[] = [];
  refreshCalls: Array<{ sourceId: string; projectId: string }> = [];
  refreshError: Error | string | null = null;
  recheckCalls: string[] = [];
  recheckError: Error | null = null;
  diffById = new Map<string, string>();
  diffError: Error | null = null;
  resolveCalls: Array<{ id: string; input: WorkResolveInput }> = [];
  webhookIngests: Array<{ sourceId: string; body: string; signature: string }> = [];
  rebuildInputs: Array<{ projectId?: string; from?: string }> = [];
  knownAdapters = new Set<string>(["shell", "github", "gitlab"]);

  projectExists(projectId: string): boolean {
    return this.projects.has(projectId);
  }

  listProjectItems(projectId: string, _input: WorkListInput): WorkPage {
    return makeWorkPage(this.itemsByProject.get(projectId) ?? []);
  }

  projectStatus(projectId: string): WorkStatus {
    return this.statuses.get(projectId) ?? makeWorkStatus();
  }

  listProjectSources(projectId: string): ProjectSourceRow[] {
    return this.sources.get(projectId) ?? [];
  }

  createProjectSource(input: CreateProjectSourceCommand) {
    this.createdSources.push(input);
    const source = {
      id: `src-${this.createdSources.length}`,
      projectId: input.projectId,
      connectionId: `conn-${this.createdSources.length}`,
      kind: input.kind,
      externalKey: input.externalKey,
      displayName: input.displayName ?? input.name,
      webUrl: input.webUrl ?? null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as unknown as ProjectSource;
    const connection = {
      id: `conn-${this.createdSources.length}`,
      adapter: input.adapter,
      baseUrl: input.baseUrl ?? null,
      configJson: JSON.stringify(input.config ?? {}),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as unknown as SourceConnection;
    return { source, connection };
  }

  async refreshSource(sourceId: string, projectId: string): Promise<unknown> {
    this.refreshCalls.push({ sourceId, projectId });
    if (this.refreshError) {
      throw this.refreshError;
    }
    return { synced: true };
  }

  getWorkItemDetail(id: string): WorkItemDetail | null {
    return this.details.get(id) ?? null;
  }

  async getWorkItemDiff(id: string): Promise<{ workItemId: string; diff: string }> {
    if (this.diffError) throw this.diffError;
    return { workItemId: id, diff: this.diffById.get(id) ?? "" };
  }

  async recheckWorkItem(id: string): Promise<WorkRecheckResult> {
    this.recheckCalls.push(id);
    if (this.recheckError) throw this.recheckError;
    return { status: "recheck_scheduled" } as unknown as WorkRecheckResult;
  }

  resolveWorkItem(id: string, input: WorkResolveInput): WorkItem {
    this.resolveCalls.push({ id, input });
    const detail = this.details.get(id);
    if (!detail) throw new Error("resolve without detail");
    return { ...detail.work, resolvedAt: "2026-01-01T00:00:00.000Z" } as WorkItem;
  }

  async ingestWebhook(sourceId: string, body: string, signature: string): Promise<unknown> {
    this.webhookIngests.push({ sourceId, body, signature });
    return { received: true };
  }

  rebuildStatusRollup(input: { projectId?: string; from?: string }): number {
    this.rebuildInputs.push(input);
    return 7;
  }

  findAdapterType(name: string): "known" | "unknown" {
    return this.knownAdapters.has(name) ? "known" : "unknown";
  }
}

const clock = new FixedClock(new Date("2026-01-01T00:00:00.000Z"));

describe("contexts/work use cases", () => {
  test("listProjectWorkQuery returns 404 when project missing", async () => {
    const store = new MemoryWorkStore();
    const result = await listProjectWorkQuery(
      { store },
      { projectId: "missing", limit: 20, offset: 0 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
      expect(result.error.status).toBe(404);
    }
  });

  test("listProjectWorkQuery returns page when project exists", async () => {
    const store = new MemoryWorkStore();
    store.projects.add("proj-1");
    store.itemsByProject.set("proj-1", []);
    const result = await listProjectWorkQuery(
      { store },
      { projectId: "proj-1", limit: 20, offset: 0 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.total).toBe(0);
  });

  test("getProjectWorkStatusQuery 404 when project missing", async () => {
    const store = new MemoryWorkStore();
    const result = await getProjectWorkStatusQuery(
      { store },
      { projectId: "missing" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(404);
  });

  test("getProjectWorkStatusQuery returns status for project", async () => {
    const store = new MemoryWorkStore();
    store.projects.add("proj-1");
    store.statuses.set(
      "proj-1",
      makeWorkStatus({ working: 3, queued: 2 }),
    );
    const result = await getProjectWorkStatusQuery(
      { store },
      { projectId: "proj-1", compareWindow: "24h" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.working).toBe(3);
      expect(result.value.queued).toBe(2);
    }
  });

  test("listProjectSourcesQuery 404 when project missing", async () => {
    const store = new MemoryWorkStore();
    const result = await listProjectSourcesQuery(
      { store },
      { projectId: "missing" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(404);
  });

  test("createProjectSourceCommand 404 when project missing", async () => {
    const store = new MemoryWorkStore();
    const uow = new InMemoryUnitOfWork();
    const result = await createProjectSourceCommand(
      { store, clock, uow },
      {
        projectId: "missing",
        name: "GitHub",
        adapter: "github",
        kind: "repository",
        externalKey: "owner/repo",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(404);
  });

  test("createProjectSourceCommand validates required fields and adapter", async () => {
    const store = new MemoryWorkStore();
    store.projects.add("proj-1");
    const uow = new InMemoryUnitOfWork();
    const result = await createProjectSourceCommand(
      { store, clock, uow },
      {
        projectId: "proj-1",
        name: "GitHub",
        adapter: "unknown-adapter",
        kind: "repository",
        externalKey: "owner/repo",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error");
      expect(result.error.status).toBe(400);
    }
  });

  test("createProjectSourceCommand emits source.attached event", async () => {
    const store = new MemoryWorkStore();
    store.projects.add("proj-1");
    const uow = new InMemoryUnitOfWork();
    const result = await createProjectSourceCommand(
      { store, clock, uow },
      {
        projectId: "proj-1",
        name: "GitHub",
        adapter: "github",
        kind: "repository",
        externalKey: "owner/repo",
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source).toBeDefined();
      expect(result.value.events).toHaveLength(1);
      expect(result.value.events[0]?.type).toBe("source.attached");
      expect(result.value.events[0]?.topics).toEqual(
        expect.arrayContaining(["dashboard", "projects", "work", "sources"]),
      );
    }
    expect(store.createdSources).toHaveLength(1);
  });

  test("refreshProjectSourceCommand 404 when project missing", async () => {
    const store = new MemoryWorkStore();
    const result = await refreshProjectSourceCommand(
      { store },
      { projectId: "missing", sourceId: "src-1" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(404);
  });

  test("refreshProjectSourceCommand syncs source and maps refresh failures", async () => {
    const store = new MemoryWorkStore();
    store.projects.add("proj-1");

    const ok = await refreshProjectSourceCommand(
      { store },
      { projectId: "proj-1", sourceId: "src-1" },
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.sync).toEqual({ synced: true });
    }
    expect(store.refreshCalls).toEqual([{ sourceId: "src-1", projectId: "proj-1" }]);

    store.refreshError = new Error("Project source not found: src-missing");
    const missing = await refreshProjectSourceCommand(
      { store },
      { projectId: "proj-1", sourceId: "src-missing" },
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("not_found");
      expect(missing.error.status).toBe(404);
    }

    store.refreshError = new Error("adapter rate limited");
    const validation = await refreshProjectSourceCommand(
      { store },
      { projectId: "proj-1", sourceId: "src-1" },
    );
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.error.code).toBe("validation_error");
      expect(validation.error.status).toBe(400);
      expect(validation.error.message).toBe("adapter rate limited");
    }
  });

  test("getWorkItemQuery returns 404 when missing", async () => {
    const store = new MemoryWorkStore();
    const result = await getWorkItemQuery({ store }, { id: "work-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(404);
  });

  test("resolveWorkItemCommand 404 for missing work item", async () => {
    const store = new MemoryWorkStore();
    const result = await resolveWorkItemCommand(
      { store },
      { id: "missing" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(404);
  });

  test("rebuildWorkStatusCommand forwards project + from and returns count", async () => {
    const store = new MemoryWorkStore();
    const result = await rebuildWorkStatusCommand(
      { store },
      { projectId: "proj-1", from: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rebuilt).toBe(true);
      expect(result.value.deleted).toBe(7);
    }
    expect(store.rebuildInputs).toEqual([
      { projectId: "proj-1", from: "2026-01-01T00:00:00Z" },
    ]);
  });

  test("rebuildWorkStatusCommand omits empty project/from", async () => {
    const store = new MemoryWorkStore();
    const result = await rebuildWorkStatusCommand({ store }, {});
    expect(result.ok).toBe(true);
    expect(store.rebuildInputs).toEqual([{}]);
  });

  test("getWorkItemDiffQuery returns diff from store", async () => {
    const store = new MemoryWorkStore();
    store.diffById.set("work-1", "diff --git a/foo b/foo");
    const result = await getWorkItemDiffQuery({ store }, { id: "work-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.workItemId).toBe("work-1");
      expect(result.value.diff).toContain("diff --git");
    }
  });

  test("getWorkItemDiffQuery maps store not-found to 404", async () => {
    const store = new MemoryWorkStore();
    store.diffError = new Error("Work item not found: work-1");
    const result = await getWorkItemDiffQuery({ store }, { id: "work-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
      expect(result.error.status).toBe(404);
    }
  });

  test("recheckWorkItemCommand returns 404 when work item missing", async () => {
    const store = new MemoryWorkStore();
    const result = await recheckWorkItemCommand({ store }, { id: "missing" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
      expect(result.error.status).toBe(404);
    }
  });
});
