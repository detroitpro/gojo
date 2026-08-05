// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, test, vi } from "vitest";

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
}));

import ProjectHistoryView from "@/contexts/catalog/views/ProjectHistoryView.vue";
import ProjectOverviewView from "@/contexts/catalog/views/ProjectOverviewView.vue";
import ProjectShellView from "@/contexts/catalog/views/ProjectShellView.vue";

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
          component: ProjectHistoryView,
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

async function mountShell(path = "/projects/project-1/overview") {
  refreshBindings.length = 0;
  mocks.getProject.mockResolvedValue({
    id: "project-1",
    name: "quotient-server",
    repoPath: "/tmp/quotient-server",
    remoteUrl: "https://github.com/quotient-research/quotient-server.git",
    defaultBranch: "main",
    manifestJson: null,
    enabled: true,
    agentCount: 0,
    enabledAgentCount: 0,
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
    workspaceFiles: {
      trackedGeneratedFiles: [],
      unignoredGeneratedFiles: [],
      untrackedRegistrationFiles: [],
      suggestedGitignore: null,
    },
  });
  mocks.listAgents.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  mocks.listProjectWork.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  mocks.getProjectWorkStatus.mockResolvedValue({
    working: 0,
    queued: 0,
    needsAttention: 0,
    verifiedOpen: 0,
    staleOpen: 0,
    asOf: null,
    previous: null,
    previousAsOf: null,
    compareWindow: "24h",
  });
  mocks.listProjectSources.mockResolvedValue([]);
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
    routes: projectRoutes(),
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(ProjectShellView, {
    global: {
      plugins: [createPinia(), router],
    },
  });
  await flushPromises();
  return { wrapper, router };
}

describe("Project shell routes", () => {
  test("redirects project-detail to overview", async () => {
    const { router } = await mountShell("/projects/project-1");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("project-overview");
  });

  test("history tab remains available from the shell", async () => {
    const { wrapper, router } = await mountShell();
    await router.push({ name: "project-history", params: { id: "project-1" } });
    await flushPromises();
    expect(wrapper.text()).toContain("History");
    wrapper.unmount();
  });
});
