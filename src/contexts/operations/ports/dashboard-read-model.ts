/**
 * Aggregated dashboard reads. The concrete implementation stays in
 * `src/storage/*` for now; this port exists so the use case is transport-free.
 */
export interface DashboardSummary {
  /** Total registered projects. */
  projects: number;
  /** Projects with `enabled: true` (schedules/work/API may enqueue). */
  enabledProjects: number;
  agents: number;
  enabledAgents: number;
  schedules: number;
  enabledSchedules: number;
  runs: number;
  activeRuns: number;
  runningRuns: number;
  waitingRuns: number;
  schedulingPolicy: unknown;
  paused: boolean;
  previous: unknown | null;
}

export interface DashboardOverview {
  projects: unknown[];
  [key: string]: unknown;
}

export interface DashboardImpact {
  [key: string]: unknown;
}

export interface QueueSnapshot {
  policy: unknown;
  counts: { running: number; waiting: number };
  waiting: unknown[];
  running: unknown[];
  total: number;
  limit: number;
  offset: number;
}

export interface DashboardReadModel {
  summary(compare: string): DashboardSummary;
  overview(): DashboardOverview;
  impact(input: {
    projectId?: string | null;
    from?: string | null;
    to?: string | null;
    range?: string | null;
  }): DashboardImpact;
  queue(input: {
    limit: number;
    offset: number;
    sort: string;
    order: "asc" | "desc";
  }): QueueSnapshot;
}
