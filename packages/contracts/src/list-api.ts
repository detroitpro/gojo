/**
 * List API sort allowlists and enriched list-row shapes shared by daemon
 * persistence and the web admin UI.
 */

export const PROJECT_SORT_ALLOWED = ["name", "createdAt", "updatedAt", "defaultBranch"] as const;

export const AGENT_SORT_ALLOWED = [
  "name",
  "projectName",
  "enabled",
  "createdAt",
  "lastRunAt",
  /** Share of Succeeded among the last 5 runs (same window as the Success column). */
  "successRate",
] as const;

export const RUN_SORT_ALLOWED = [
  "createdAt",
  "finishedAt",
  "state",
  "trigger",
  "agentName",
  "projectName",
] as const;

export const SCHEDULE_SORT_ALLOWED = [
  "name",
  "projectName",
  "cronExpr",
  "nextRunAt",
  "lastRunAt",
  "enabled",
  "createdAt",
] as const;

export const QUEUE_SORT_ALLOWED = [
  "position",
  "priority",
  "notBeforeAt",
  "expiresAt",
  "projectName",
  "agentName",
] as const;

export const TOKEN_SORT_ALLOWED = ["name", "createdAt", "expiresAt"] as const;

export const BACKUP_SORT_ALLOWED = ["name", "createdAt"] as const;

export const INTEGRATION_LIST_STATUSES = ["all", "open", "merged", "committed"] as const;

export type IntegrationListStatus = (typeof INTEGRATION_LIST_STATUSES)[number];

export const INTEGRATION_SORT_ALLOWED = [
  "activityAt",
  "openedAt",
  "mergedAt",
  "createdAt",
  "projectName",
  "agentName",
  "prNumber",
] as const;

/** Default list sort key for each integration list status filter. */
export function defaultIntegrationSort(status: IntegrationListStatus): string {
  if (status === "merged") return "mergedAt";
  if (status === "committed") return "createdAt";
  if (status === "all") return "activityAt";
  return "openedAt";
}

export const IMPACT_ITEM_SORT_ALLOWED = [
  "createdAt",
  "category",
  "subject",
  "projectName",
  "agentName",
] as const;

/** List filter for GET /integrations (not always equal to row.status). */
export interface IntegrationListItem {
  runId: string;
  projectId: string;
  projectName: string | null;
  agentId: string;
  agentName: string | null;
  prNumber: number | null;
  prUrl: string | null;
  provider: string | null;
  repo: string | null;
  /** Actual run_integrations.status (not the list filter). */
  status: string;
  commitSha: string | null;
  openedAt: string | null;
  mergedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  branchName: string | null;
  runCreatedAt: string;
}

export interface ImpactItemListRow {
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

export interface ProjectSummaryCounts {
  agentCount: number;
  enabledAgentCount: number;
  scheduleCount: number;
  enabledScheduleCount: number;
  hasManifest: boolean;
  /** Source-verified open PRs; stale last-known-open resources are excluded. */
  openPrCount: number;
}
