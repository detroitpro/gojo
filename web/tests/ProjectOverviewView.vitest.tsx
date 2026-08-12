// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import AppProvider from "@atlaskit/app-provider";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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

import { ProjectOverviewView } from "@/contexts/catalog/views/ProjectOverviewView";
import { ProjectShellView } from "@/contexts/catalog/views/ProjectShellView";

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

  const result = render(
    <AppProvider defaultColorMode="light">
      <MemoryRouter initialEntries={["/projects/project-1/overview"]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectShellView />}>
            <Route path="overview" element={<ProjectOverviewView />} />
            <Route path="history" element={<div>History</div>} />
            <Route path="health" element={<div>Health</div>} />
            <Route path="impact" element={<div>Impact</div>} />
            <Route
              path="configuration"
              element={<div>Configuration</div>}
            />
          </Route>
          <Route path="/projects" element={<div />} />
          <Route path="/runs/:id" element={<div />} />
          <Route path="/agents" element={<div />} />
          <Route path="/schedules" element={<div />} />
          <Route path="/runs" element={<div />} />
          <Route path="/integrations" element={<div />} />
          <Route path="/impact" element={<div />} />
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );

  await waitFor(() => {
    expect(mocks.getProject).toHaveBeenCalled();
  });
  // Allow all effects/promises to settle so overview loads.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return result;
}

afterEach(() => {
  localStorage.clear();
});

describe("ProjectOverviewView briefing", () => {
  test("omits attention chrome when nothing needs action", async () => {
    const { container } = await mountOverview();
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("Recent changes"),
    );
    expect(container.textContent ?? "").not.toContain("No items need your attention");
    expect(container.textContent ?? "").not.toContain("Needs your attention");
    expect(container.querySelector(".attention-summary")).toBeNull();
    expect(container.textContent ?? "").toContain("No completed changes yet");
    expect(container.textContent ?? "").not.toContain("Progress summary");
    expect(container.textContent ?? "").not.toContain("In progress");
    expect(container.textContent ?? "").not.toContain("Operations");
    expect(container.textContent ?? "").not.toContain("Project details");
  });

  test("surfaces attention items near the top", async () => {
    const { container } = await mountOverview({
      activeItems: [workItem()],
      status: { needsAttention: 1, staleOpen: 1 },
    });
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("Needs your attention"),
    );
    expect(container.textContent ?? "").toContain(
      "Add report-only maintain-issue-tags agent",
    );
    expect(container.textContent ?? "").toContain("Recheck now");
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
    const { container } = await mountOverview({
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
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("Backlog"),
    );
    expect(container.textContent ?? "").not.toContain("No items need your attention");
    expect(container.textContent ?? "").not.toContain("Needs your attention");
    expect(container.textContent ?? "").not.toContain("Ordinary backlog issue");
    expect(container.textContent ?? "").toContain("Open issues");
    expect(container.textContent ?? "").toContain("Closed issues");
    expect(container.textContent ?? "").toContain("PRs open");
    expect(container.textContent ?? "").toContain("PRs merged");
    expect(container.textContent ?? "").toContain("PRs closed");
    expect(container.textContent ?? "").toContain("Delivery");
    expect(container.textContent ?? "").not.toContain("Reliability");
    expect(container.textContent ?? "").not.toContain("Throughput");
    const anchors = Array.from(container.querySelectorAll("a"));
    const openIssuesLink = anchors.find((a) =>
      (a.getAttribute("href") ?? "").endsWith(
        "github.com/quotient-research/quotient-server/issues",
      ),
    );
    expect(openIssuesLink).toBeTruthy();
    expect(openIssuesLink!.getAttribute("target")).toBe("_blank");
    const openPrsLink = anchors.find((a) =>
      (a.getAttribute("href") ?? "").endsWith(
        "github.com/quotient-research/quotient-server/pulls",
      ),
    );
    expect(openPrsLink).toBeTruthy();
  });

  test("shows completed work outcomes in the primary section", async () => {
    const recent = completedWork({
      completedAt: new Date().toISOString(),
    });
    const { container } = await mountOverview({
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
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("Recent changes"),
    );
    expect(container.textContent ?? "").toContain("Today");
    expect(container.textContent ?? "").toContain("Repository Maintainer");
    expect(container.textContent ?? "").toContain("remote branch cleanup");
    expect(container.textContent ?? "").toContain("Documentation updates");
    expect(container.textContent ?? "").not.toContain("Progress summary");
    expect(container.textContent ?? "").toContain("Copy");
    const anchors = Array.from(container.querySelectorAll("a"));
    const runLink = anchors.find((a) =>
      (a.getAttribute("href") ?? "").includes("/runs/run-99"),
    );
    expect(runLink).toBeTruthy();
    expect(runLink!.textContent ?? "").toContain("Harden worktree lifecycle");
  });

  test("shows in progress only when active work exists", async () => {
    const { container } = await mountOverview({
      activeItems: [runningWork()],
      status: { working: 1 },
    });
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("In progress"),
    );
    expect(container.textContent ?? "").toContain("Updating repository dependencies");
    expect(container.textContent ?? "").toContain("View live run");
  });

  test("highlights disabled project state", async () => {
    const { container } = await mountOverview({ enabled: false });
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("Project disabled"),
    );
    expect(container.textContent ?? "").toContain("blocked");
  });

  test("shows backlog inventory even when activity totals are zero", async () => {
    const { container } = await mountOverview();
    await waitFor(() => expect(container.textContent ?? "").toContain("Backlog"));
    expect(container.textContent ?? "").toContain("PRs open");
    expect(container.textContent ?? "").toContain("PRs merged");
    expect(container.textContent ?? "").toContain("PRs closed");
    expect(container.textContent ?? "").toContain("Delivery");
    expect(container.textContent ?? "").not.toContain("Needs Attention: 0");
  });

  test("shows delivery metrics in one row section", async () => {
    const { container } = await mountOverview({
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
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("Delivery"),
    );
    expect(container.textContent ?? "").toContain("Merged");
    expect(container.textContent ?? "").toContain("Succeeded runs");
    expect(container.textContent ?? "").toContain("Commits");
    expect(container.textContent ?? "").not.toContain("Reliability");
    expect(container.textContent ?? "").not.toContain("Throughput");
  });

  test("shows failed history request state", async () => {
    const { container } = await mountOverview({ historyReject: true });
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("history failed"),
    );
    expect(container.textContent ?? "").toContain("Retry");
  });

  test("loads recent completed work without a time window", async () => {
    const { container } = await mountOverview({
      historyItems: [completedWork()],
    });
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("Recent changes"),
    );
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
  });

  test("keeps Remove in the overflow menu", async () => {
    const { container } = await mountOverview();
    const menuTrigger = await waitFor(() =>
      screen.getByRole("button", { name: /project actions/i }),
    );
    await act(async () => {
      fireEvent.click(menuTrigger);
    });
    await waitFor(() =>
      expect(document.body.textContent ?? "").toContain("Remove project"),
    );
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (b) => (b.textContent ?? "").trim() === "Remove",
      ),
    ).toBe(false);
  });

  test("recheck clears attention and keeps history accessible", async () => {
    const { container } = await mountOverview({
      activeItems: [workItem()],
      status: { needsAttention: 1, staleOpen: 1 },
    });
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("Needs your attention"),
    );
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
    mocks.listProjectWork.mockImplementation(
      (_id: string, query?: { history?: boolean }) => {
        if (query?.history) {
          return Promise.resolve({ items: [closedItem], total: 1, limit: 100, offset: 0 });
        }
        return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
      },
    );
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

    const recheckButton = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Recheck now"),
    );
    expect(recheckButton).toBeTruthy();
    await act(async () => {
      fireEvent.click(recheckButton!);
    });

    await waitFor(() => expect(mocks.recheckWorkItem).toHaveBeenCalledWith("work-stale"));
    await waitFor(() =>
      expect(container.textContent ?? "").toContain(
        "Verified Add report-only maintain-issue-tags agent as closed",
      ),
    );
    expect(container.textContent ?? "").not.toContain("No items need your attention");
    expect(container.textContent ?? "").not.toContain("Needs your attention");
    // Silence unused-import lint noise:
    void within;
  });
});
