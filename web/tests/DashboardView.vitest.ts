// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, test, vi } from "vitest";

const refreshBindings = vi.hoisted(
  () => [] as Array<() => void | Promise<void>>,
);

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  overview: vi.fn(),
  impact: vi.fn(),
}));

vi.mock("@/platform/bind-store-refresh", () => ({
  bindStoreRefresh(_store: unknown, refresh: () => Promise<void> | void) {
    refreshBindings.push(refresh);
    void refresh();
  },
}));

vi.mock("@/contexts/operations/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/operations/contract")>()),
  getDashboard: mocks.dashboard,
  getDashboardOverview: mocks.overview,
  getDashboardImpact: mocks.impact,
  pauseInstance: vi.fn(),
  resumeInstance: vi.fn(),
}));

import DashboardView from "@/contexts/operations/views/DashboardView.vue";

function impact() {
  return {
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
  };
}

describe("DashboardView live refresh", () => {
  test("refreshes mounted metrics when store refresh bindings run", async () => {
    refreshBindings.length = 0;
    mocks.dashboard.mockResolvedValue({
      projects: 2,
      enabledProjects: 1,
      agents: 4,
      enabledAgents: 2,
      schedules: 6,
      enabledSchedules: 3,
      runs: 4,
      activeRuns: 1,
      runningRuns: 1,
      waitingRuns: 0,
      paused: false,
    });
    mocks.overview.mockResolvedValue({ projects: [] });
    mocks.impact.mockResolvedValue(impact());
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", name: "dashboard", component: { template: "<div />" } },
        { path: "/queue", name: "queue", component: { template: "<div />" } },
        { path: "/projects", name: "projects", component: { template: "<div />" } },
        { path: "/projects/:id", name: "project-detail", component: { template: "<div />" } },
        { path: "/agents", name: "agents", component: { template: "<div />" } },
        { path: "/schedules", name: "schedules", component: { template: "<div />" } },
        { path: "/runs", name: "runs", component: { template: "<div />" } },
        { path: "/integrations", name: "integrations", component: { template: "<div />" } },
        { path: "/impact", name: "impact", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(DashboardView, {
      global: { plugins: [createPinia(), router] },
    });
    await flushPromises();
    expect(wrapper.find(".status-band-primary .value").text()).toBe("1");
    expect(wrapper.text()).toContain("1/2");
    expect(wrapper.text()).toContain("2/4");
    expect(wrapper.text()).toContain("3/6");

    mocks.dashboard.mockResolvedValue({
      projects: 2,
      enabledProjects: 1,
      agents: 4,
      enabledAgents: 2,
      schedules: 6,
      enabledSchedules: 3,
      runs: 5,
      activeRuns: 5,
      runningRuns: 5,
      waitingRuns: 2,
      paused: false,
    });
    expect(refreshBindings.length).toBeGreaterThan(0);
    await refreshBindings[0]!();
    await flushPromises();

    expect(wrapper.find(".status-band-primary .value").text()).toBe("5");
    expect(wrapper.text()).toContain("2 waiting in queue");
    expect(wrapper.text()).toContain("1/2");
    expect(wrapper.text()).toContain("2/4");
    expect(wrapper.text()).toContain("3/6");
    wrapper.unmount();
  });
});
