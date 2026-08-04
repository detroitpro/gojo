import type {
  WorkItem,
  WorkRecheckResult,
  WorkResolveInput,
  WorkStatus,
  WorkStatusCompareWindow,
} from "@shared/work";

import type {
  ProjectSource,
  SourceConnection,
  WorkEvent,
  WorkLink,
  WorkListInput,
  WorkPage,
  RunContextRecord,
} from "@/contexts/work/infrastructure/work-repositories";

/** Snapshot of a project source enriched with connection + cursor. */
export type ProjectSourceRow = ProjectSource & {
  connection: SourceConnection | null;
  cursor: { cursor: string | null; backfillComplete: boolean } | null;
};

export interface CreateProjectSourceCommand {
  projectId: string;
  name: string;
  adapter: string;
  baseUrl?: string | null;
  config?: Record<string, unknown>;
  kind: string;
  externalKey: string;
  displayName?: string | null;
  webUrl?: string | null;
}

export interface CreateProjectSourceResult {
  source: ProjectSource;
  connection: SourceConnection;
}

export interface WorkItemDetail {
  work: WorkItem;
  links: WorkLink[];
  events: WorkEvent[];
  runContext: RunContextRecord | null;
}

/**
 * Read/write surface the work context application handlers depend on.
 * Backed by `WorkRepositories` + `SourceSyncService` + `MergeService`
 * in production; substitutable for unit tests.
 */
export interface WorkStore {
  projectExists(projectId: string): boolean;
  listProjectItems(projectId: string, input: WorkListInput): WorkPage;
  projectStatus(
    projectId: string,
    options: { compareWindow?: WorkStatusCompareWindow },
  ): WorkStatus;
  listProjectSources(projectId: string): ProjectSourceRow[];
  createProjectSource(
    input: CreateProjectSourceCommand,
  ): CreateProjectSourceResult;
  refreshSource(sourceId: string, projectId: string): Promise<unknown>;
  getWorkItemDetail(workItemId: string): WorkItemDetail | null;
  getWorkItemDiff(workItemId: string): Promise<{ workItemId: string; diff: string }>;
  recheckWorkItem(workItemId: string): Promise<WorkRecheckResult>;
  resolveWorkItem(
    workItemId: string,
    input: WorkResolveInput,
  ): WorkItem;
  ingestWebhook(
    sourceId: string,
    body: string,
    signature: string,
  ): Promise<unknown>;
  rebuildStatusRollup(input: {
    projectId?: string;
    from?: string;
  }): number;
  findAdapterType(name: string): "known" | "unknown";
}
