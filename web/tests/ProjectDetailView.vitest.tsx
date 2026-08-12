// @vitest-environment happy-dom
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import AppProvider from "@atlaskit/app-provider";
import { createMemoryRouter, Navigate, RouterProvider } from "react-router-dom";

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

vi.mock("@/contexts/catalog/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/catalog/contract")>()),
  getProject: mocks.getProject,
  listAgents: mocks.listAgents,
  listImpactItems: vi.fn(async () => ({ items: [], total: 0, limit: 100, offset: 0 })),
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

import { ProjectHistoryView } from "@/contexts/catalog/views/ProjectHistoryView";
import { ProjectOverviewView } from "@/contexts/catalog/views/ProjectOverviewView";
import { ProjectShellView } from "@/contexts/catalog/views/ProjectShellView";

function stubDataMocks() {
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
}

function makeRouter(initialPath: string) {
  return createMemoryRouter(
    [
      {
        path: "/projects/:id",
        element: <ProjectShellView />,
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          { path: "overview", element: <ProjectOverviewView /> },
          { path: "history", element: <ProjectHistoryView /> },
          { path: "health", element: <div>Health</div> },
          { path: "impact", element: <div>Impact</div> },
          { path: "configuration", element: <div>Configuration</div> },
        ],
      },
      { path: "/projects", element: <div /> },
      { path: "/runs/:id", element: <div /> },
      { path: "/agents", element: <div /> },
      { path: "/schedules", element: <div /> },
      { path: "/runs", element: <div /> },
      { path: "/integrations", element: <div /> },
      { path: "/impact", element: <div /> },
    ],
    { initialEntries: [initialPath] },
  );
}

async function mountShell(path = "/projects/project-1/overview") {
  stubDataMocks();
  const router = makeRouter(path);
  const utils = render(
    <AppProvider defaultColorMode="light">
      <RouterProvider router={router} />
    </AppProvider>,
  );
  await waitFor(() => expect(mocks.getProject).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
  return { ...utils, router };
}

describe("Project shell routes", () => {
  test("redirects project index to overview", async () => {
    const { router } = await mountShell("/projects/project-1");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/project-1/overview"),
    );
  });

  test("history tab remains available from the shell", async () => {
    const { router, container } = await mountShell();
    await act(async () => {
      await router.navigate("/projects/project-1/history");
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/project-1/history"),
    );
    expect(container.textContent ?? "").toContain("History");
  });
});
