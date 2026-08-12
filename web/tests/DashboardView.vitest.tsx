// @vitest-environment happy-dom
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import AppProvider from "@atlaskit/app-provider";
import { MemoryRouter } from "react-router-dom";

const refreshBindings = vi.hoisted(
  () => [] as Array<() => void | Promise<void>>,
);

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  overview: vi.fn(),
  impact: vi.fn(),
}));

vi.mock("@/platform/bind-store-refresh", async () => {
  const React = await import("react");
  // Views wrap `load` in useCallback with unstable deps (soft.run identity churns
  // each render), so subscribing on every identity change turns into an infinite
  // refresh loop. Anchor the effect to mount and read the latest refresh via a ref
  // so manual `refreshBindings[i]()` still hits the current handler.
  const hook = (_store: unknown, refresh: () => Promise<void> | void) => {
    const refreshRef = React.useRef(refresh);
    refreshRef.current = refresh;
    React.useEffect(() => {
      const fn = () => refreshRef.current();
      refreshBindings.push(fn);
      void refreshRef.current();
      return () => {
        const idx = refreshBindings.indexOf(fn);
        if (idx >= 0) refreshBindings.splice(idx, 1);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  };
  return { useBindStoreRefresh: hook, bindStoreRefresh: hook };
});

vi.mock("@/contexts/operations/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/operations/contract")>()),
  getDashboard: mocks.dashboard,
  getDashboardOverview: mocks.overview,
  getDashboardImpact: mocks.impact,
  pauseInstance: vi.fn(),
  resumeInstance: vi.fn(),
}));

import { DashboardView } from "@/contexts/operations/views/DashboardView";

function impactPayload() {
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
    mocks.impact.mockResolvedValue(impactPayload());

    const { container } = render(
      <AppProvider defaultColorMode="light">
        <MemoryRouter initialEntries={["/"]}>
          <DashboardView />
        </MemoryRouter>
      </AppProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector(".status-band-primary .value")?.textContent).toBe("1"),
    );
    expect(container.textContent ?? "").toContain("1/2");
    expect(container.textContent ?? "").toContain("2/4");
    expect(container.textContent ?? "").toContain("3/6");

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
    await act(async () => {
      await refreshBindings[0]!();
    });

    await waitFor(() =>
      expect(container.querySelector(".status-band-primary .value")?.textContent).toBe("5"),
    );
    expect(container.textContent ?? "").toContain("2 waiting in queue");
    expect(container.textContent ?? "").toContain("1/2");
    expect(container.textContent ?? "").toContain("2/4");
    expect(container.textContent ?? "").toContain("3/6");
  });

  test("defaults to enabled projects and can reveal disabled via header select", async () => {
    refreshBindings.length = 0;
    mocks.dashboard.mockResolvedValue({
      projects: 2,
      enabledProjects: 1,
      agents: 1,
      enabledAgents: 1,
      schedules: 1,
      enabledSchedules: 1,
      runs: 0,
      activeRuns: 0,
      runningRuns: 0,
      waitingRuns: 0,
      paused: false,
    });
    mocks.overview.mockResolvedValue({
      projects: [
        {
          id: "p-on",
          name: "enabled-proj",
          enabled: true,
          agents: [],
        },
        {
          id: "p-off",
          name: "disabled-proj",
          enabled: false,
          agents: [],
        },
      ],
    });
    mocks.impact.mockResolvedValue(impactPayload());

    const { container } = render(
      <AppProvider defaultColorMode="light">
        <MemoryRouter initialEntries={["/"]}>
          <DashboardView />
        </MemoryRouter>
      </AppProvider>,
    );

    await waitFor(() => expect(container.textContent ?? "").toContain("enabled-proj"));
    expect(container.textContent ?? "").not.toContain("disabled-proj");
    expect(container.querySelector("#dashboard-project-filter")).toBeTruthy();
    expect(container.querySelector(".filter-bar")).toBeNull();
  });
});
