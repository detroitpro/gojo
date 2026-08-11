// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, test, vi } from "vitest";

const refreshBindings = vi.hoisted(
  () => [] as Array<() => void | Promise<void>>,
);

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectDoctor: vi.fn(),
  listAgents: vi.fn(),
  listProjectWork: vi.fn(),
  getProjectWorkStatus: vi.fn(),
  listProjectSources: vi.fn(),
  getDashboardImpact: vi.fn(),
  listImpactItems: vi.fn(),
  listIntegrations: vi.fn(),
  recheckWorkItem: vi.fn(),
  refreshProjectSource: vi.fn(),
  resolveWorkItem: vi.fn(),
}));

vi.mock("@/platform/bind-store-refresh", () => ({
  bindStoreRefresh(_store: unknown, refresh: () => Promise<void> | void) {
    refreshBindings.push(refresh);
    void refresh();
  },
}));

vi.mock("@/contexts/catalog/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/catalog/contract")>()),
  getProject: mocks.getProject,
  listAgents: mocks.listAgents,
  listImpactItems: mocks.listImpactItems,
  syncProject: vi.fn(),
  deleteProject: vi.fn(),
  runAgent: vi.fn(),
}));

vi.mock("@/contexts/operations/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/operations/contract")>()),
  getProjectDoctor: mocks.getProjectDoctor,
  getDashboardImpact: mocks.getDashboardImpact,
}));

vi.mock("@/contexts/work/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/work/contract")>()),
  listProjectWork: mocks.listProjectWork,
  getProjectWorkStatus: mocks.getProjectWorkStatus,
  listProjectSources: mocks.listProjectSources,
  recheckWorkItem: mocks.recheckWorkItem,
  refreshProjectSource: mocks.refreshProjectSource,
  resolveWorkItem: mocks.resolveWorkItem,
}));

vi.mock("@/contexts/delivery/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/delivery/contract")>()),
  listIntegrations: mocks.listIntegrations,
}));

import ProjectOverviewView from "@/contexts/catalog/views/ProjectOverviewView.vue";
import ProjectShellView from "@/contexts/catalog/views/ProjectShellView.vue";

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
    nativeJson: "{}",
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

function completedWork(overrides: Record<string, unknown> = {}) {
  return workItem({
    id: "work-done",
    kind: "run",
    nativeKey: "run-99",
    title: "Harden worktree lifecycle",
    summary: "Added remote branch cleanup and retention telemetry.",
    execution: "terminal",
    delivery: "none",
    outcome: "succeeded",
    attention: "none",
    syncState: "current",
    lastError: null,
    agentName: "Repository Maintainer",
    completedAt: "2026-08-04T10:00:00.000Z",
    webUrl: null,
    sourceId: null,
    ...overrides,
  });
}

function runningWork() {
  return workItem({
    id: "work-running",
    kind: "run",
    nativeKey: "run-active",
    title: "Updating repository dependencies",
    summary: "Running tests",
    execution: "running",
    delivery: "none",
    outcome: "pending",
    attention: "none",
    syncState: "current",
    lastError: null,
    agentName: "Dependency Maintainer",
    startedAt: "2026-08-04T11:00:00.000Z",
    completedAt: null,
    webUrl: null,
    sourceId: null,
  });
}

function projectRoutes() {
  return [
    {
      path: "/projects/:id",
      component: ProjectShellView,
      children: [
        {
          path: "",
          name: "project-detail",
          redirect: { name: "project-overview" },
        },
        {
          path: "overview",
          name: "project-overview",
          component: ProjectOverviewView,
        },
        {
          path: "history",
          name: "project-history",
          component: { template: "<div>History</div>" },
        },
        {
          path: "health",
          name: "project-health",
          component: { template: "<div>Health</div>" },
        },
        {
          path: "impact",
          name: "project-impact",
          component: { template: "<div>Impact</div>" },
        },
        {
          path: "configuration",
          name: "project-configuration",
          component: { template: "<div>Configuration</div>" },
        },
      ],
    },
    { path: "/projects", name: "projects", component: { template: "<div />" } },
    { path: "/runs/:id", name: "run-detail", component: { template: "<div />" } },
    { path: "/agents", name: "agents", component: { template: "<div />" } },
    { path: "/schedules", name: "schedules", component: { template: "<div />" } },
    { path: "/runs", name: "runs", component: { template: "<div />" } },
    { path: "/integrations", name: "integrations", component: { template: "<div />" } },
    { path: "/impact", name: "impact", component: { template: "<div />" } },
  ];
}

type MountOptions = {
  enabled?: boolean;
  activeItems?: unknown[];
  historyItems?: unknown[];
  impactItems?: unknown[];
  status?: Record<string, unknown>;
  impact?: Record<string, unknown> | null;
  impactReject?: boolean;
  historyReject?: boolean;
  closedIssuesTotal?: number;
  openPullRequestsTotal?: number;
  openIntegrationPrs?: number;
  mergedPrsTotal?: number;
  closedPrsTotal?: number;
};

async function mountOverview(options: MountOptions = {}) {
  refreshBindings.length = 0;
  localStorage.clear();

  mocks.getProject.mockResolvedValue({
    id: "project-1",
    name: "quotient-server",
    repoPath: "/tmp/quotient-server",
    remoteUrl: "https://github.com/quotient-research/quotient-server.git",
    defaultBranch: "main",
    manifestJson: null,
    enabled: options.enabled ?? true,
    agentCount: 2,
    enabledAgentCount: 2,
    scheduleCount: 1,
    enabledScheduleCount: 1,
    hasManifest: true,
    openPrCount: 0,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
  });
  mocks.getProjectDoctor.mockResolvedValue({
    projectId: "project-1",
    repoExists: true,
    manifest: true,
    baseCheckout: { clean: true, dirtyFiles: [], behindOrigin: 0 },
    validationTools: [],
    workspaceFiles: {
      trackedGeneratedFiles: [],
      unignoredGeneratedFiles: [],
      untrackedRegistrationFiles: [],
      suggestedGitignore: null,
    },
  });
  mocks.listAgents.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  mocks.listImpactItems.mockResolvedValue({
    items: options.impactItems ?? [],
    total: (options.impactItems ?? []).length,
    limit: 100,
    offset: 0,
  });
  mocks.listProjectWork.mockImplementation(
    (
      _id: string,
      query?: { history?: boolean; kind?: string; delivery?: string },
    ) => {
      if (options.historyReject && query?.history) {
        return Promise.reject(new Error("history failed"));
      }
      if (query?.kind === "issue" && query.delivery === "closed") {
        return Promise.resolve({
          items: [],
          total: options.closedIssuesTotal ?? 0,
          limit: 1,
          offset: 0,
        });
      }
      if (query?.kind === "issue" && query.delivery === "open") {
        const openIssues = (options.activeItems ?? []).filter(
          (item) =>
            (item as { kind?: string; delivery?: string }).kind === "issue" &&
            (item as { delivery?: string }).delivery === "open",
        );
        return Promise.resolve({
          items: [],
          total: openIssues.length,
          limit: 1,
          offset: 0,
        });
      }
      if (query?.kind === "pull-request" && query.delivery === "open") {
        return Promise.resolve({
          items: [],
          total: options.openPullRequestsTotal ?? 0,
          limit: 1,
          offset: 0,
        });
      }
      if (query?.kind === "pull-request" && query.delivery === "merged") {
        return Promise.resolve({
          items: [],
          total: options.mergedPrsTotal ?? 0,
          limit: 1,
          offset: 0,
        });
      }
      if (query?.kind === "pull-request" && query.delivery === "closed") {
        return Promise.resolve({
          items: [],
          total: options.closedPrsTotal ?? 0,
          limit: 1,
          offset: 0,
        });
      }
      if (query?.history) {
        return Promise.resolve({
          items: options.historyItems ?? [],
          total: (options.historyItems ?? []).length,
          limit: 100,
          offset: 0,
        });
      }
      return Promise.resolve({
        items: options.activeItems ?? [],
        total: (options.activeItems ?? []).length,
        limit: 100,
        offset: 0,
      });
    },
  );
  mocks.listIntegrations.mockResolvedValue({
    items: [],
    total: options.openIntegrationPrs ?? 0,
    limit: 1,
    offset: 0,
  });
  mocks.getProjectWorkStatus.mockResolvedValue({
    working: 0,
    queued: 0,
    needsAttention: 0,
    verifiedOpen: 0,
    staleOpen: 0,
    asOf: "2026-07-27T20:23:47.000Z",
    previous: null,
    previousAsOf: null,
    compareWindow: "24h",
    ...options.status,
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
  if (options.impactReject) {
    mocks.getDashboardImpact.mockRejectedValue(new Error("impact failed"));
  } else {
    mocks.getDashboardImpact.mockResolvedValue(
      options.impact ?? {
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
      },
    );
  }

  const router = createRouter({
    history: createMemoryHistory(),
    routes: projectRoutes(),
  });
  await router.push("/projects/project-1/overview");
  await router.isReady();
  const wrapper = mount(ProjectShellView, {
    global: {
      plugins: [createPinia(), router],
    },
  });
  await flushPromises();
  return { wrapper, router };
}

afterEach(() => {
  localStorage.clear();
});

describe("ProjectOverviewView briefing", () => {
  test("shows quiet attention state when nothing needs action", async () => {
    const { wrapper } = await mountOverview();
    expect(wrapper.text()).toContain("No items need your attention");
    expect(wrapper.text()).not.toContain("Needs your attention");
    expect(wrapper.text()).toContain("Recent changes");
    expect(wrapper.text()).toContain("No completed changes yet");
    expect(wrapper.text()).not.toContain("Progress summary");
    expect(wrapper.text()).not.toContain("In progress");
    expect(wrapper.text()).not.toContain("Operations");
    expect(wrapper.text()).not.toContain("Project details");
    wrapper.unmount();
  });

  test("surfaces attention items near the top", async () => {
    const { wrapper } = await mountOverview({
      activeItems: [workItem()],
      status: { needsAttention: 1, staleOpen: 1 },
    });
    expect(wrapper.text()).toContain("Needs your attention");
    expect(wrapper.text()).toContain("Add report-only maintain-issue-tags agent");
    expect(wrapper.text()).toContain("Recheck now");
    wrapper.unmount();
  });

  test("does not list open backlog issues as needing attention", async () => {
    const openIssue = workItem({
      id: "work-open",
      attention: "none",
      delivery: "open",
      syncState: "current",
      lastError: null,
      title: "Ordinary backlog issue",
    });
    const { wrapper } = await mountOverview({
      activeItems: [openIssue],
      status: { needsAttention: 0, verifiedOpen: 0, staleOpen: 0 },
      closedIssuesTotal: 4,
      impact: {
        totals: {
          succeededRuns: 1,
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
        window: { from: "2026-07-05T00:00:00.000Z", to: "2026-08-04T00:00:00.000Z" },
        previousWindow: null,
        range: "30d",
      },
    });
    expect(wrapper.text()).toContain("No items need your attention");
    expect(wrapper.text()).not.toContain("Needs your attention");
    expect(wrapper.text()).not.toContain("Ordinary backlog issue");
    expect(wrapper.text()).toContain("Backlog");
    expect(wrapper.text()).toContain("Open issues");
    expect(wrapper.text()).toContain("Closed issues");
    expect(wrapper.text()).toContain("PRs open");
    expect(wrapper.text()).toContain("PRs merged");
    expect(wrapper.text()).toContain("PRs closed");
    // Delivery holds merged / merge rate / succeeded runs / commits together.
    expect(wrapper.text()).toContain("Delivery");
    expect(wrapper.text()).not.toContain("Reliability");
    expect(wrapper.text()).not.toContain("Throughput");
    const openIssuesLink = wrapper
      .findAll("a")
      .find((anchor) =>
        (anchor.attributes("href") ?? "").endsWith(
          "github.com/quotient-research/quotient-server/issues",
        ),
      );
    expect(openIssuesLink).toBeTruthy();
    expect(openIssuesLink!.attributes("target")).toBe("_blank");
    const openPrsLink = wrapper
      .findAll("a")
      .find((anchor) =>
        (anchor.attributes("href") ?? "").endsWith(
          "github.com/quotient-research/quotient-server/pulls",
        ),
      );
    expect(openPrsLink).toBeTruthy();
    wrapper.unmount();
  });

  test("shows completed work outcomes in the primary section", async () => {
    const recent = completedWork({
      completedAt: new Date().toISOString(),
    });
    const { wrapper } = await mountOverview({
      historyItems: [recent],
      impactItems: [
        {
          id: "impact-1",
          runId: "run-99",
          projectId: "project-1",
          projectName: "quotient-server",
          agentId: "agent-1",
          agentName: "Repository Maintainer",
          category: "documentation",
          subject: "README",
          summary: "Updated docs",
          source: "platform",
          verification: "verified",
          confidence: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(wrapper.text()).toContain("Recent changes");
    expect(wrapper.text()).toContain("Today");
    expect(wrapper.text()).toContain("Repository Maintainer");
    expect(wrapper.text()).toContain("remote branch cleanup");
    expect(wrapper.text()).toContain("Documentation updates");
    expect(wrapper.text()).not.toContain("Progress summary");
    expect(wrapper.text()).toContain("Copy");
    const runLink = wrapper
      .findAll("a")
      .find((anchor) => (anchor.attributes("href") ?? "").includes("/runs/run-99"));
    expect(runLink).toBeTruthy();
    expect(runLink!.text()).toContain("Harden worktree lifecycle");
    wrapper.unmount();
  });

  test("shows in progress only when active work exists", async () => {
    const { wrapper } = await mountOverview({
      activeItems: [runningWork()],
      status: { working: 1 },
    });
    expect(wrapper.text()).toContain("In progress");
    expect(wrapper.text()).toContain("Updating repository dependencies");
    expect(wrapper.text()).toContain("View live run");
    wrapper.unmount();
  });

  test("highlights disabled project state", async () => {
    const { wrapper } = await mountOverview({ enabled: false });
    expect(wrapper.text()).toContain("Project disabled");
    expect(wrapper.text()).toContain("blocked");
    wrapper.unmount();
  });

  test("shows backlog inventory even when activity totals are zero", async () => {
    const { wrapper } = await mountOverview();
    expect(wrapper.text()).toContain("Backlog");
    expect(wrapper.text()).toContain("PRs open");
    expect(wrapper.text()).toContain("PRs merged");
    expect(wrapper.text()).toContain("PRs closed");
    expect(wrapper.text()).toContain("Delivery");
    expect(wrapper.text()).not.toContain("Needs Attention: 0");
    wrapper.unmount();
  });

  test("shows delivery metrics in one row section", async () => {
    const { wrapper } = await mountOverview({
      impact: {
        totals: {
          succeededRuns: 4,
          prsOpened: 1,
          prsOpen: 0,
          mergedRuns: 2,
          closedUnmerged: 0,
          commits: 9,
          mergeRate: 0.5,
        },
        categoryTotals: [{ category: "reliability", runs: 2 }],
        recentItems: [],
        previousTotals: {
          succeededRuns: 2,
          prsOpened: 0,
          prsOpen: 0,
          mergedRuns: 1,
          closedUnmerged: 0,
          commits: 4,
          mergeRate: 0.4,
        },
        window: { from: "2026-07-05T00:00:00.000Z", to: "2026-08-04T00:00:00.000Z" },
        previousWindow: { from: "2026-06-05T00:00:00.000Z", to: "2026-07-05T00:00:00.000Z" },
        range: "30d",
      },
    });
    expect(wrapper.text()).toContain("Delivery");
    expect(wrapper.text()).toContain("Merged");
    expect(wrapper.text()).toContain("Succeeded runs");
    expect(wrapper.text()).toContain("Commits");
    expect(wrapper.text()).not.toContain("Reliability");
    expect(wrapper.text()).not.toContain("Throughput");
    wrapper.unmount();
  });

  test("shows failed history request state", async () => {
    const { wrapper } = await mountOverview({ historyReject: true });
    expect(wrapper.text()).toContain("history failed");
    expect(wrapper.text()).toContain("Retry");
    wrapper.unmount();
  });

  test("loads recent completed work without a time window", async () => {
    const { wrapper } = await mountOverview({
      historyItems: [completedWork()],
    });
    const feedCalls = mocks.listProjectWork.mock.calls.filter((call) => {
      const query = call[1] as { history?: boolean; kind?: string } | undefined;
      return Boolean(query?.history) && !query?.kind;
    });
    expect(feedCalls.length).toBeGreaterThan(0);
    expect(
      feedCalls.every((call) => {
        const query = call[1] as { from?: string; to?: string; limit?: number };
        return !query.from && !query.to && query.limit === 25;
      }),
    ).toBe(true);
    expect(wrapper.text()).toContain("Recent changes");
    wrapper.unmount();
  });

  test("keeps Remove in the overflow menu", async () => {
    const { wrapper } = await mountOverview();
    const menuTrigger = wrapper.find('[aria-label="Project actions"]');
    expect(menuTrigger.exists()).toBe(true);
    await menuTrigger.trigger("click");
    await flushPromises();
    const menuText = document.body.textContent ?? "";
    expect(menuText).toContain("Remove project");
    // Routine header actions remain visible; destructive Remove is menu-only.
    expect(wrapper.findAll("button").some((button) => button.text() === "Remove")).toBe(false);
    wrapper.unmount();
  });

  test("recheck clears attention and keeps history accessible", async () => {
    const { wrapper } = await mountOverview({
      activeItems: [workItem()],
      status: { needsAttention: 1, staleOpen: 1 },
    });
    const closedItem = workItem({
      attention: "none",
      delivery: "closed",
      syncState: "current",
      lastError: null,
      completedAt: "2026-07-27T21:00:00.000Z",
    });
    mocks.recheckWorkItem.mockResolvedValue({
      status: "terminal",
      detail: null,
      work: closedItem,
    });
    mocks.listProjectWork.mockImplementation((_id: string, query?: { history?: boolean }) => {
      if (query?.history) {
        return Promise.resolve({ items: [closedItem], total: 1, limit: 100, offset: 0 });
      }
      return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
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
    await recheckButton!.trigger("click");
    await flushPromises();

    expect(mocks.recheckWorkItem).toHaveBeenCalledWith("work-stale");
    expect(wrapper.text()).toContain("No items need your attention");
    expect(wrapper.text()).toContain("Verified Add report-only maintain-issue-tags agent as closed");
    wrapper.unmount();
  });
});
