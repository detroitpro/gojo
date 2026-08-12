// @vitest-environment happy-dom
/**
 * Behavior lock: every admin view mounts against a stubbed API without throwing.
 * Preserve mount contracts when refactoring — keep each smoke case green.
 */
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AppProvider from "@atlaskit/app-provider";
import { createMemoryRouter, Navigate, RouterProvider } from "react-router-dom";
import type { ReactElement } from "react";

const emptyPage = { items: [], total: 0, limit: 25, offset: 0 };

const refreshBindings = vi.hoisted(
  () => [] as Array<() => void | Promise<void>>,
);

vi.mock("@/platform/bind-store-refresh", async () => {
  const React = await import("react");
  // Views wrap `load` in useCallback with unstable deps (soft.run identity churns
  // each render), so subscribing on every identity change turns into an infinite
  // refresh loop. Anchor the effect to mount and read the latest refresh via a ref
  // so manual `refreshBindings[i]()` still hits the current handler.
  const hook = (_store: unknown, refresh: () => void | Promise<void>) => {
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

// Charts, live streams, and heavy panels aren't part of the smoke contract.
vi.mock("@/ui/RunTimelineChart", () => ({
  RunTimelineChart: () => null,
}));
vi.mock("@/ui/SchedulesTimelineChart", () => ({
  SchedulesTimelineChart: () => null,
}));
vi.mock("@/ui/RunActivityFeed", () => ({
  RunActivityFeed: () => null,
}));
vi.mock("@/ui/RunHistoryStrip", () => ({
  RunHistoryStrip: () => null,
}));
vi.mock("@/contexts/execution/components/RunActivitySection", () => ({
  RunActivitySection: () => null,
}));
vi.mock("@/contexts/execution/components/RunArtifactsSection", () => ({
  RunArtifactsSection: () => null,
}));
vi.mock("@/contexts/work/components/ProjectWorkPanel", () => ({
  ProjectWorkPanel: () => null,
}));
vi.mock("@/contexts/work/components/ProjectHistoryPanel", () => ({
  ProjectHistoryPanel: () => null,
}));
vi.mock("@/contexts/work/components/ProjectSourcesPanel", () => ({
  ProjectSourcesPanel: () => null,
}));
vi.mock("@/contexts/catalog/components/ProjectImpactSection", () => ({
  ProjectImpactSection: () => null,
}));
vi.mock("@/contexts/catalog/components/overview/ProjectImpactBrief", () => ({
  ProjectImpactBrief: () => null,
}));
vi.mock("@/contexts/catalog/components/overview/RecentActivitySection", () => ({
  RecentActivitySection: () => null,
}));
vi.mock("@/contexts/catalog/components/overview/AttentionSummary", () => ({
  AttentionSummary: () => null,
}));
vi.mock("@/contexts/catalog/components/overview/CurrentActivitySection", () => ({
  CurrentActivitySection: () => null,
}));
vi.mock("@/contexts/catalog/components/ProjectHealthPanel", () => ({
  ProjectHealthPanel: () => null,
}));
vi.mock("@/contexts/catalog/components/ProjectConfigurationPanel", () => ({
  ProjectConfigurationPanel: () => null,
}));
vi.mock("@/contexts/operations/components/SettingsInstanceSection", () => ({
  SettingsInstanceSection: () => null,
}));
vi.mock("@/contexts/scheduling/components/SettingsSchedulingSection", () => ({
  SettingsSchedulingSection: () => null,
}));
vi.mock("@/contexts/operations/components/SettingsDoctorSection", () => ({
  SettingsDoctorSection: () => null,
}));
vi.mock("@/contexts/access/components/SettingsTokensSection", () => ({
  SettingsTokensSection: () => null,
}));
vi.mock("@/contexts/operations/components/SettingsBackupsSection", () => ({
  SettingsBackupsSection: () => null,
}));
vi.mock("@/contexts/notifications/components/NotificationChannelsPanel", () => ({
  NotificationChannelsPanel: () => null,
}));
vi.mock("@/contexts/operations/components/DirectoryPicker", () => ({
  DirectoryPicker: () => null,
}));

const api = vi.hoisted(() => {
  const project = {
    id: "p1",
    name: "demo",
    repoPath: "/tmp/demo",
    remoteUrl: null,
    defaultBranch: "main",
    manifestJson: "{}",
    enabled: true,
    agentCount: 0,
    enabledAgentCount: 0,
    scheduleCount: 0,
    enabledScheduleCount: 0,
    hasManifest: true,
    openPrCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const run = {
    id: "run1",
    projectId: "p1",
    agentId: "a1",
    scheduleId: null,
    state: "Succeeded",
    idempotencyKey: "k1",
    trigger: "manual",
    priority: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:01.000Z",
    finishedAt: "2026-01-01T00:00:02.000Z",
    branchName: "gojo/create-file/demo/2026-01-01/run-run1",
    projectName: "demo",
    agentName: "hello",
    errorMessage: null,
    workItemId: null,
  };
  return {
    checkSession: vi.fn(async () => ({ id: "u1", username: "admin", role: "admin" })),
    getHealth: vi.fn(async () => ({ ok: true, version: "0.1.0", paused: false })),
    probeSetupNeeded: vi.fn(async () => false),
    getDashboard: vi.fn(async () => ({
      projects: 0,
      enabledProjects: 0,
      agents: 0,
      enabledAgents: 0,
      schedules: 0,
      enabledSchedules: 0,
      runs: 0,
      activeRuns: 0,
      runningRuns: 0,
      waitingRuns: 0,
      paused: false,
      previous: null,
    })),
    getDashboardOverview: vi.fn(async () => ({ projects: [] })),
    getDashboardImpact: vi.fn(async () => ({
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
    })),
    getQueue: vi.fn(async () => ({
      policy: {
        maxConcurrentRuns: 2,
        maxConcurrentRunsPerProject: 1,
        minStartIntervalMs: 0,
        maxLoadPerCpu: 0,
      },
      counts: { running: 0, waiting: 0 },
      waiting: [],
      running: [],
      total: 0,
      limit: 25,
      offset: 0,
    })),
    listProjects: vi.fn(async () => emptyPage),
    listAgents: vi.fn(async () => emptyPage),
    listRuns: vi.fn(async () => emptyPage),
    listSchedules: vi.fn(async () => emptyPage),
    listSchedulesUpcoming: vi.fn(async () => ({
      horizonHours: 168,
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-08T00:00:00.000Z",
      schedules: [],
    })),
    listIntegrations: vi.fn(async () => emptyPage),
    listApprovals: vi.fn(async () => emptyPage),
    listImpactItems: vi.fn(async () => emptyPage),
    listAdapters: vi.fn(async () => [{ name: "shell", installed: true, version: "1" }]),
    getProject: vi.fn(async () => project),
    getProjectDoctor: vi.fn(async () => ({
      projectId: "p1",
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
    })),
    listProjectWork: vi.fn(async () => emptyPage),
    getProjectWorkStatus: vi.fn(async () => ({
      working: 0,
      queued: 0,
      needsAttention: 0,
      verifiedOpen: 0,
      staleOpen: 0,
      asOf: "2026-01-01T00:00:00.000Z",
      previous: null,
      previousAsOf: null,
      compareWindow: "24h",
    })),
    listProjectSources: vi.fn(async () => []),
    syncProject: vi.fn(async () => ({
      sync: { agents: 0, profiles: 0, schedules: 0, manifestPath: null },
      project,
    })),
    deleteProject: vi.fn(async () => true),
    recheckWorkItem: vi.fn(),
    refreshProjectSource: vi.fn(),
    resolveWorkItem: vi.fn(),
    runAgent: vi.fn(),
    getAgent: vi.fn(async () => ({
      id: "a1",
      projectId: "p1",
      name: "hello",
      enabled: true,
      description: "d",
      prompt: "echo",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      projectName: "demo",
      successRate: null,
    })),
    getRun: vi.fn(async () => ({
      run,
      attempts: [],
      impactItems: [],
      integration: null,
      approval: null,
    })),
    getRunDiff: vi.fn(async () => ({ files: [], patch: "" })),
    getRunArtifacts: vi.fn(async () => ({ artifacts: [] })),
    subscribeRunEvents: vi.fn(() => () => undefined),
    cancelRun: vi.fn(),
    approveRun: vi.fn(),
    rejectRun: vi.fn(),
    retryRun: vi.fn(),
    getInstance: vi.fn(async () => ({
      bindHost: "127.0.0.1",
      bindPort: 7430,
      publicBaseUrl: null,
      trustedProxies: [],
      allowedOrigins: [],
      ipAllowlist: [],
      cookieSecure: "auto",
      paused: false,
      telemetryEnabled: false,
      apiBaseUrl: "http://127.0.0.1:7430",
    })),
    getMe: vi.fn(async () => ({ id: "u1", username: "admin", role: "admin" })),
    listNotificationChannels: vi.fn(async () => ({})),
    getInstanceDoctor: vi.fn(async () => ({
      git: true,
      disk: true,
      database: true,
      agents: [{ name: "shell", installed: true }],
      home: "/tmp/gojo",
      daemonPath: "/tmp/gojo/bin/gojo",
      tools: [],
      binaryStale: false,
      binaryStatus: { stale: false, detail: null, exePath: null },
      warnings: [],
    })),
    getSchedulingPolicy: vi.fn(async () => ({
      maxConcurrentRuns: 2,
      maxConcurrentRunsPerProject: 1,
      minStartIntervalMs: 0,
      maxLoadPerCpu: 0,
    })),
    listApiTokens: vi.fn(async () => emptyPage),
    listBackups: vi.fn(async () => emptyPage),
    browseFilesystem: vi.fn(async () => ({
      listing: { path: "/tmp", parent: null, entries: [], isGitRepo: false },
      roots: [{ label: "Home", path: "/tmp" }],
    })),
    pauseInstance: vi.fn(),
    resumeInstance: vi.fn(),
    updateInstance: vi.fn(),
    updateSchedulingPolicy: vi.fn(),
    changePassword: vi.fn(),
    createApiToken: vi.fn(),
    revokeApiToken: vi.fn(),
    createBackup: vi.fn(),
    verifyBackup: vi.fn(),
    putNotificationChannels: vi.fn(),
    testNotificationChannel: vi.fn(),
    enableAgent: vi.fn(),
    disableAgent: vi.fn(),
    enableSchedule: vi.fn(),
    disableSchedule: vi.fn(),
    testAdapter: vi.fn(),
    createProject: vi.fn(),
    updateApproval: vi.fn(),
    getWorkDiff: vi.fn(),
    login: vi.fn(),
    setup: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock("@/contexts/access/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/access/contract")>()),
  checkSession: api.checkSession,
  login: api.login,
  setup: api.setup,
  logout: api.logout,
  changePassword: api.changePassword,
  createApiToken: api.createApiToken,
  revokeApiToken: api.revokeApiToken,
  listApiTokens: api.listApiTokens,
  getMe: api.getMe,
  probeSetupNeeded: api.probeSetupNeeded,
}));

vi.mock("@/contexts/operations/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/operations/contract")>()),
  getHealth: api.getHealth,
  getInstance: api.getInstance,
  getDashboard: api.getDashboard,
  getDashboardOverview: api.getDashboardOverview,
  getDashboardImpact: api.getDashboardImpact,
  pauseInstance: api.pauseInstance,
  resumeInstance: api.resumeInstance,
  updateInstance: api.updateInstance,
  getInstanceDoctor: api.getInstanceDoctor,
  listBackups: api.listBackups,
  createBackup: api.createBackup,
  verifyBackup: api.verifyBackup,
  browseFilesystem: api.browseFilesystem,
  getProjectDoctor: api.getProjectDoctor,
}));

vi.mock("@/contexts/scheduling/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/scheduling/contract")>()),
  getQueue: api.getQueue,
  getSchedulingPolicy: api.getSchedulingPolicy,
  updateSchedulingPolicy: api.updateSchedulingPolicy,
  listSchedulesUpcoming: api.listSchedulesUpcoming,
}));

vi.mock("@/contexts/notifications/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/notifications/contract")>()),
  listNotificationChannels: api.listNotificationChannels,
  putNotificationChannels: api.putNotificationChannels,
  testNotificationChannel: api.testNotificationChannel,
}));

vi.mock("@/contexts/catalog/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/catalog/contract")>()),
  listProjects: api.listProjects,
  createProject: api.createProject,
  getProject: api.getProject,
  syncProject: api.syncProject,
  deleteProject: api.deleteProject,
  listAgents: api.listAgents,
  getAgent: api.getAgent,
  enableAgent: api.enableAgent,
  disableAgent: api.disableAgent,
  listSchedules: api.listSchedules,
  enableSchedule: api.enableSchedule,
  disableSchedule: api.disableSchedule,
  listAdapters: api.listAdapters,
  testAdapter: api.testAdapter,
  listImpactItems: api.listImpactItems,
  runAgent: api.runAgent,
}));

vi.mock("@/contexts/delivery/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/delivery/contract")>()),
  listIntegrations: api.listIntegrations,
  listApprovals: api.listApprovals,
  updateApproval: api.updateApproval,
}));

vi.mock("@/contexts/work/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/work/contract")>()),
  listProjectWork: api.listProjectWork,
  getProjectWorkStatus: api.getProjectWorkStatus,
  listProjectSources: api.listProjectSources,
  refreshProjectSource: api.refreshProjectSource,
  recheckWorkItem: api.recheckWorkItem,
  resolveWorkItem: api.resolveWorkItem,
  getWorkDiff: api.getWorkDiff,
}));

vi.mock("@/contexts/execution/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/execution/contract")>()),
  listRuns: api.listRuns,
  getRun: api.getRun,
  cancelRun: api.cancelRun,
  approveRun: api.approveRun,
  rejectRun: api.rejectRun,
  retryRun: api.retryRun,
  getRunDiff: api.getRunDiff,
  getRunArtifacts: api.getRunArtifacts,
  subscribeRunEvents: api.subscribeRunEvents,
}));

import { AdaptersView } from "@/contexts/catalog/views/AdaptersView";
import { AgentDetailView } from "@/contexts/catalog/views/AgentDetailView";
import { AgentsView } from "@/contexts/catalog/views/AgentsView";
import { ApprovalsView } from "@/contexts/delivery/views/ApprovalsView";
import { DashboardView } from "@/contexts/operations/views/DashboardView";
import { ImpactView } from "@/contexts/catalog/views/ImpactView";
import { IntegrationsView } from "@/contexts/delivery/views/IntegrationsView";
import { LoginView } from "@/contexts/access/views/LoginView";
import { ProjectOverviewView } from "@/contexts/catalog/views/ProjectOverviewView";
import { ProjectShellView } from "@/contexts/catalog/views/ProjectShellView";
import { ProjectsView } from "@/contexts/catalog/views/ProjectsView";
import { QueueView } from "@/contexts/scheduling/views/QueueView";
import { RunDetailView } from "@/contexts/execution/views/RunDetailView";
import { RunsView } from "@/contexts/execution/views/RunsView";
import { SchedulesView } from "@/contexts/catalog/views/SchedulesView";
import { SettingsView } from "@/contexts/operations/views/SettingsView";

const routes = [
  { path: "/login", element: <LoginView /> },
  { path: "/", element: <DashboardView /> },
  { path: "/projects", element: <ProjectsView /> },
  {
    path: "/projects/:id",
    element: <ProjectShellView />,
    children: [
      { index: true, element: <Navigate to="overview" replace /> },
      { path: "overview", element: <ProjectOverviewView /> },
      { path: "history", element: <div>History</div> },
      { path: "impact", element: <div>Impact</div> },
      { path: "health", element: <div>Health</div> },
      { path: "configuration", element: <div>Configuration</div> },
    ],
  },
  { path: "/agents", element: <AgentsView /> },
  { path: "/agents/:id", element: <AgentDetailView /> },
  { path: "/runs", element: <RunsView /> },
  { path: "/runs/:id", element: <RunDetailView /> },
  { path: "/integrations", element: <IntegrationsView /> },
  { path: "/approvals", element: <ApprovalsView /> },
  { path: "/impact", element: <ImpactView /> },
  { path: "/queue", element: <QueueView /> },
  { path: "/schedules", element: <SchedulesView /> },
  { path: "/adapters", element: <AdaptersView /> },
  { path: "/settings", element: <SettingsView /> },
];

async function mountAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <AppProvider defaultColorMode="light">
      <RouterProvider router={router} />
    </AppProvider>,
  );
  // Let the initial async load settle.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

describe("contract/web/views-smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshBindings.length = 0;
  });

  const cases: Array<[string, string, string?]> = [
    ["login", "/login", "gojo"],
    ["dashboard", "/", "Dashboard"],
    ["projects", "/projects", "Projects"],
    ["project-overview", "/projects/p1/overview"],
    ["agents", "/agents", "Agents"],
    ["agent-detail", "/agents/a1"],
    ["runs", "/runs", "Runs"],
    ["run-detail", "/runs/run1"],
    ["integrations", "/integrations", "Integrations"],
    ["approvals", "/approvals", "Approvals"],
    ["impact", "/impact", "Impact"],
    ["queue", "/queue", "Queue"],
    ["schedules", "/schedules", "Schedules"],
    ["adapters", "/adapters", "Adapters"],
    ["settings", "/settings", "Settings"],
  ];

  for (const [name, path, heading] of cases) {
    test(`mounts ${name} without throwing`, async () => {
      const { container } = await mountAt(path);
      expect(container.innerHTML.length).toBeGreaterThan(0);
      if (heading) {
        await waitFor(() =>
          expect(container.textContent ?? "").toContain(heading),
        );
      }
    });
  }
  // Type-only: silence unused warnings.
  void (null as unknown as ReactElement);
});
