export type {
  AdapterInfo,
  AdapterTestResult,
  DashboardOverviewRun,
  ImpactItemListRow,
  ProjectBaseCheckout,
  ProjectSummaryCounts,
  ProjectSyncResult,
  Schedule as ContractSchedule,
  Agent as ContractAgent,
  Project as ContractProject,
} from "@gojo/contracts/types";

import type {
  Agent as ContractAgent,
  DashboardOverviewRun,
  Project as ContractProject,
  ProjectSummaryCounts,
  ProjectSyncResult,
  Schedule as ContractSchedule,
} from "@gojo/contracts/types";

/** API project row: entity fields + summary counts; list omits manifestJson. */
export type Project = Omit<ContractProject, "manifestJson"> &
  ProjectSummaryCounts & {
    manifestJson?: string;
  };

export interface ProjectSyncResponse {
  project: Project;
  sync: ProjectSyncResult;
}

export interface AgentSource {
  repoPath: string;
  manifestPath: string | null;
  promptFile: string | null;
  promptAbsolutePath: string | null;
}

/** Agent with list/detail enrichments. */
export type Agent = ContractAgent & {
  projectName?: string | null;
  profileName?: string | null;
  lastRunId?: string | null;
  lastRunState?: string | null;
  lastRunCreatedAt?: string | null;
  recentRuns?: DashboardOverviewRun[];
  source?: AgentSource;
};

/** Schedule with list enrichments. */
export type Schedule = ContractSchedule & {
  agentName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  cronDescription?: string | null;
};
