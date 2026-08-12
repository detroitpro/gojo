/**
 * Dashboard overview, impact analytics, and queue snapshot shapes.
 */
import type { RunState } from "./run-states";
import type { RunTrigger } from "./run-trigger";
import type { SchedulingPolicy } from "./scheduling";
import type { WorkStatusCompareWindow } from "./work";

export interface DashboardPreviousStats {
  runningRuns: number;
  waitingRuns: number;
  runs: number;
  asOf: string;
  compareWindow: WorkStatusCompareWindow;
}

/** `GET /api/v1/dashboard` inventory + live run pulse. */
export interface DashboardStats {
  projects: number;
  /** Projects with `enabled: true`. UI shows `enabledProjects/projects`. */
  enabledProjects: number;
  agents: number;
  /** Agents with `enabled: true`. UI shows `enabledAgents/agents`. */
  enabledAgents: number;
  schedules: number;
  /** Schedules with `enabled: true`. UI shows `enabledSchedules/schedules`. */
  enabledSchedules: number;
  runs: number;
  activeRuns: number;
  runningRuns: number;
  waitingRuns: number;
  schedulingPolicy: SchedulingPolicy;
  paused: boolean;
  previous: DashboardPreviousStats | null;
}

export interface DashboardOverviewRun {
  id: string;
  state: RunState;
  trigger: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface DashboardOverviewAgent {
  id: string;
  name: string;
  description: string;
  recentRuns: DashboardOverviewRun[];
}

export interface DashboardOverviewProject {
  id: string;
  name: string;
  /** When false, schedules/API for this project are blocked. */
  enabled: boolean;
  agents: DashboardOverviewAgent[];
}

export interface DashboardOverview {
  projects: DashboardOverviewProject[];
}

export type DashboardImpactRange = "30d" | "90d" | "all";

export interface DashboardImpactWindow {
  from: string | null;
  to: string | null;
}

export interface DashboardImpactTotals {
  succeededRuns: number;
  /** Integrations that produced a real PR (any current status). */
  prsOpened: number;
  /** Source-current open PRs; stale last-known-open work is excluded. */
  prsOpen: number;
  /** Runs whose canonical integration status is `merged`. */
  mergedRuns: number;
  /** PRs closed without merging. */
  closedUnmerged: number;
  /** Integrations that produced a commit. */
  commits: number;
  /** mergedRuns / all merge-intent integrations; null when nothing tracked. */
  mergeRate: number | null;
}

/**
 * Distinct runs that produced impact in a category.
 * Totals intentionally overlap across categories: a run that changed docs and
 * deps counts in both, so categoryTotals do not sum to a run total.
 */
export interface DashboardImpactCategoryTotal {
  category: string;
  runs: number;
}

export interface DashboardImpactRecentItem {
  id: string;
  runId: string;
  projectId: string;
  projectName: string;
  agentId: string;
  agentName: string;
  category: string;
  subject: string;
  summary: string;
  source: string;
  verification: string;
  confidence: number | null;
  createdAt: string;
}

export interface DashboardImpact {
  totals: DashboardImpactTotals;
  categoryTotals: DashboardImpactCategoryTotal[];
  recentItems: DashboardImpactRecentItem[];
  previousTotals: DashboardImpactTotals | null;
  window: DashboardImpactWindow;
  previousWindow: DashboardImpactWindow | null;
  range: DashboardImpactRange | null;
}

export function parseImpactRange(
  value: string | null | undefined,
): DashboardImpactRange | null {
  if (value === "30d" || value === "90d" || value === "all") return value;
  return null;
}

export interface QueueWaitingItem {
  runId: string;
  projectId: string;
  projectName: string | null;
  agentId: string;
  agentName: string | null;
  trigger: RunTrigger;
  priority: number;
  notBeforeAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  position: number;
}

export interface QueueRunningItem {
  runId: string;
  projectId: string;
  projectName: string | null;
  agentId: string;
  agentName: string | null;
  state: RunState;
  admittedAt: string | null;
}

export interface QueueSnapshot {
  policy: SchedulingPolicy;
  counts: { running: number; waiting: number };
  waiting: QueueWaitingItem[];
  running: QueueRunningItem[];
  total: number;
  limit: number;
  offset: number;
}
