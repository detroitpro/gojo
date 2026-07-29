// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  live: [] as Array<{ topics: string[]; refresh: () => Promise<void> | void }>,
  getProject: vi.fn(),
  getProjectDoctor: vi.fn(),
  listTasks: vi.fn(),
  listProjectWork: vi.fn(),
  getProjectWorkStatus: vi.fn(),
  listProjectSources: vi.fn(),
  getDashboardImpact: vi.fn(),
  recheckWorkItem: vi.fn(),
  refreshProjectSource: vi.fn(),
  resolveWorkItem: vi.fn(),
}));

vi.mock("@/composables/useLiveQuery", () => ({
  useLiveRefresh(options: { topics: string[]; refresh: () => Promise<void> | void }) {
    mocks.live.push(options);
    void options.refresh();
    return { status: { value: "connected" }, refresh: options.refresh };
  },
}));

vi.mock("@/api", () => ({
  getProject: mocks.getProject,
  getProjectDoctor: mocks.getProjectDoctor,
  listTasks: mocks.listTasks,
  listProjectWork: mocks.listProjectWork,
  getProjectWorkStatus: mocks.getProjectWorkStatus,
  listProjectSources: mocks.listProjectSources,
  getDashboardImpact: mocks.getDashboardImpact,
  recheckWorkItem: mocks.recheckWorkItem,
  refreshProjectSource: mocks.refreshProjectSource,
  resolveWorkItem: mocks.resolveWorkItem,
  syncProject: vi.fn(),
  deleteProject: vi.fn(),
  runTask: vi.fn(),
}));

import ProjectDetailView from "@/views/ProjectDetailView.vue";

function workItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "work-stale",
    projectId: "project-1",
    sourceId: "source-1",
    kind: "issue",
    nativeKey: "issue:9",
    title: "Add report-only maintain-issue-tags agent",
    summary: "",
    execution: "none",
    delivery: "open",
    outcome: "pending",
    attention: "stale",
    provenance: "external",
    actorName: null,
    labels: [],
    nativeState: "opened",
    webUrl: "https://github.com/quotient-research/quotient-server/issues/9",
    observedAt: "2026-07-27T20:23:47.000Z",
    nextSyncAt: null,
    syncState: "stale",
    lastError: "No longer present in the source active-work snapshot",
    resolution: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    createdAt: "2026-07-27T20:23:47.000Z",
    updatedAt: "2026-07-27T20:23:47.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

async function mountView() {
  mocks.live.length = 0;
  mocks.getProject.mockResolvedValue({
    id: "project-1",
    name: "quotient-server",
    repoPath: "/tmp/quotient-server",
    remoteUrl: "https://github.com/quotient-research/quotient-server.git",
    defaultBranch: "main",
    manifestJson: null,
    taskCount: 0,
    enabledTaskCount: 0,
    scheduleCount: 0,
    enabledScheduleCount: 0,
    hasManifest: false,
    openPrCount: 0,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
  });
  mocks.getProjectDoctor.mockResolvedValue({
    projectId: "project-1",
    repoExists: true,
    manifest: false,
    baseCheckout: { clean: true, dirtyFiles: [], behindOrigin: 0 },
    validationTools: [],
  });
  mocks.listTasks.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  mocks.listProjectWork.mockResolvedValue({
    items: [workItem()],
    total: 1,
    limit: 100,
    offset: 0,
  });
  mocks.getProjectWorkStatus.mockResolvedValue({
    working: 0,
    queued: 0,
    needsAttention: 1,
    verifiedOpen: 0,
    staleOpen: 1,
    asOf: "2026-07-27T20:23:47.000Z",
    previous: {
      working: 0,
      queued: 0,
      needsAttention: 0,
      verifiedOpen: 0,
      staleOpen: 0,
    },
    previousAsOf: "2026-07-26T20:23:47.000Z",
    compareWindow: "24h",
  });
  mocks.listProjectSources.mockResolvedValue([
    {
      id: "source-1",
      projectId: "project-1",
      connectionId: "conn-1",
      kind: "repository",
      externalKey: "quotient-research/quotient-server",
      displayName: "quotient-research/quotient-server",
      webUrl: "https://github.com/quotient-research/quotient-server",
      syncState: "current",
      observedAt: "2026-07-27T20:23:47.000Z",
      nextSyncAt: null,
      lastError: null,
      connection: {
        id: "conn-1",
        name: "github.com",
        adapter: "github",
        capabilities: { workKinds: ["pull-request", "issue"] },
      },
    },
  ]);
  mocks.getDashboardImpact.mockResolvedValue({
    totals: {
      succeededRuns: 0,
      prsOpened: 0,
      prsOpen: 0,
      mergedRuns: 0,
      closedUnmerged: 0,
      commits: 0,
      mergeRate: null,
    },
    categoryTotals: [],
    recentItems: [],
    previousTotals: null,
    window: { from: null, to: null },
    previousWindow: null,
    range: "30d",
  });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/projects/:id", name: "project-detail", component: ProjectDetailView },
      { path: "/projects", name: "projects", component: { template: "<div />" } },
      { path: "/runs/:id", name: "run-detail", component: { template: "<div />" } },
      { path: "/tasks", name: "tasks", component: { template: "<div />" } },
      { path: "/schedules", name: "schedules", component: { template: "<div />" } },
      { path: "/runs", name: "runs", component: { template: "<div />" } },
      { path: "/integrations", name: "integrations", component: { template: "<div />" } },
      { path: "/impact", name: "impact", component: { template: "<div />" } },
    ],
  });
  await router.push("/projects/project-1");
  await router.isReady();
  const wrapper = mount(ProjectDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe("ProjectDetailView attention actions", () => {
  test("links stale work and rechecks it into History", async () => {
    const wrapper = await mountView();
    expect(wrapper.text()).toContain("Needs attention");
    expect(wrapper.text()).toContain("Add report-only maintain-issue-tags agent");
    expect(wrapper.text()).toContain("Recheck now");
    const link = wrapper
      .findAll("a")
      .find((anchor) =>
        anchor.attributes("href")?.includes("github.com/quotient-research/quotient-server/issues/9"),
      );
    expect(link).toBeTruthy();

    mocks.recheckWorkItem.mockResolvedValue({
      status: "terminal",
      detail: null,
      work: workItem({
        attention: "none",
        delivery: "closed",
        syncState: "current",
        lastError: null,
        completedAt: "2026-07-27T21:00:00.000Z",
      }),
    });
    mocks.listProjectWork.mockResolvedValue({
      items: [
        workItem({
          attention: "none",
          delivery: "closed",
          syncState: "current",
          lastError: null,
          completedAt: "2026-07-27T21:00:00.000Z",
        }),
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });
    mocks.getProjectWorkStatus.mockResolvedValue({
      working: 0,
      queued: 0,
      needsAttention: 0,
      verifiedOpen: 0,
      staleOpen: 0,
      asOf: "2026-07-27T21:00:00.000Z",
      previous: null,
      previousAsOf: null,
      compareWindow: "24h",
    });

    const recheckButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Recheck now"));
    expect(recheckButton).toBeTruthy();
    await recheckButton!.trigger("click");
    await flushPromises();

    expect(mocks.recheckWorkItem).toHaveBeenCalledWith("work-stale");
    expect(wrapper.text()).toContain("Needs attention0");
    expect(wrapper.findAll("button").some((button) => button.text().includes("Recheck now"))).toBe(
      false,
    );
    expect(wrapper.text()).toContain("History");
    expect(wrapper.find('[aria-label="Closed"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Issue"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Verified Add report-only maintain-issue-tags agent as closed");
    wrapper.unmount();
  });
});
