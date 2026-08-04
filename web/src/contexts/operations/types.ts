export type {
  BackupInfo,
  BrowseRoot,
  DashboardImpact,
  DashboardImpactCategoryTotal,
  DashboardImpactRange,
  DashboardImpactRecentItem,
  DashboardImpactTotals,
  DashboardImpactWindow,
  DashboardOverview,
  DashboardOverviewAgent,
  DashboardOverviewProject,
  DashboardOverviewRun,
  DirectoryEntry,
  DirectoryListing,
  DoctorToolCheck,
  HealthInfo,
  InstanceDoctorResult,
  InstanceInfo,
  InstanceNetworkDoctor,
  ProjectDoctorResult,
  ProjectValidationToolCheck,
  ProjectWorkspaceFilesCheck,
  SchedulingPolicy,
  WorkStatusCompareWindow,
} from "@gojo/contracts/types";

import type { SchedulingPolicy, WorkStatusCompareWindow } from "@gojo/contracts/types";

export interface DashboardPreviousStats {
  runningRuns: number;
  waitingRuns: number;
  runs: number;
  asOf: string;
  compareWindow: WorkStatusCompareWindow;
}

export interface DashboardStats {
  projects: number;
  agents: number;
  schedules: number;
  runs: number;
  activeRuns: number;
  runningRuns?: number;
  waitingRuns?: number;
  schedulingPolicy?: SchedulingPolicy;
  paused: boolean;
  previous?: DashboardPreviousStats | null;
}
