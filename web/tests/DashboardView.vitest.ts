// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  live: [] as Array<{ topics: string[]; refresh: () => Promise<void> | void }>,
  dashboard: vi.fn(),
  overview: vi.fn(),
  impact: vi.fn(),
}));

vi.mock("@/composables/useLiveQuery", () => ({
  useLiveRefresh(options: { topics: string[]; refresh: () => Promise<void> | void }) {
    mocks.live.push(options);
    void options.refresh();
    return { status: { value: "connected" }, refresh: options.refresh };
  },
}));

vi.mock("@/api", () => ({
  getDashboard: mocks.dashboard,
  getDashboardOverview: mocks.overview,
  getDashboardImpact: mocks.impact,
  pauseInstance: vi.fn(),
  resumeInstance: vi.fn(),
}));

import DashboardView from "@/views/DashboardView.vue";

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
  test("refreshes mounted metrics when a dashboard invalidation arrives", async () => {
    mocks.live.length = 0;
    mocks.dashboard.mockResolvedValue({
      projects: 1,
      tasks: 2,
      schedules: 3,
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
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(DashboardView, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.find(".status-band-primary .value").text()).toBe("1");

    mocks.dashboard.mockResolvedValue({
      projects: 1,
      tasks: 2,
      schedules: 3,
      runs: 5,
      activeRuns: 5,
      runningRuns: 5,
      waitingRuns: 2,
      paused: false,
    });
    const dashboardSubscription = mocks.live.find((entry) =>
      entry.topics.includes("dashboard"),
    );
    expect(dashboardSubscription).toBeDefined();
    await dashboardSubscription!.refresh();
    await flushPromises();

    expect(wrapper.find(".status-band-primary .value").text()).toBe("5");
    expect(wrapper.text()).toContain("2 waiting in queue");
    wrapper.unmount();
  });
});
