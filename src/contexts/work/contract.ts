/**
 * Public surface of the work context.
 * Cross-context imports must go through this module.
 */
export type {
  NormalizedSourceItem,
  SourceAdapter,
  SourceGetItemInput,
  SourceGetItemResult,
  SourceListInput,
  SourceListResult,
} from "./ports/source-adapter";
export { SourceAdapterRegistry } from "./ports/source-adapter";

export type {
  CreateProjectSourceCommand,
  CreateProjectSourceResult,
  ProjectSourceRow,
  WorkItemDetail,
  WorkStore,
} from "./ports/work-store";

export type {
  ListProjectWorkInput,
  ListProjectWorkDeps,
} from "./application/list-project-work";
export { listProjectWorkQuery } from "./application/list-project-work";

export type {
  GetProjectWorkStatusInput,
  GetProjectWorkStatusDeps,
} from "./application/get-project-work-status";
export { getProjectWorkStatusQuery } from "./application/get-project-work-status";

export type {
  ListProjectSourcesInput,
  ListProjectSourcesDeps,
} from "./application/list-project-sources";
export { listProjectSourcesQuery } from "./application/list-project-sources";

export type { CreateProjectSourceDeps } from "./application/create-project-source";
export { createProjectSourceCommand } from "./application/create-project-source";

export type {
  RefreshProjectSourceInput,
  RefreshProjectSourceDeps,
} from "./application/refresh-project-source";
export { refreshProjectSourceCommand } from "./application/refresh-project-source";

export type {
  GetWorkItemInput,
  GetWorkItemDeps,
} from "./application/get-work-item";
export { getWorkItemQuery } from "./application/get-work-item";

export type {
  GetWorkItemDiffInput,
  GetWorkItemDiffDeps,
} from "./application/get-work-item-diff";
export { getWorkItemDiffQuery } from "./application/get-work-item-diff";

export type {
  RecheckWorkItemInput,
  RecheckWorkItemDeps,
} from "./application/recheck-work-item";
export { recheckWorkItemCommand } from "./application/recheck-work-item";

export type {
  ResolveWorkItemInput,
  ResolveWorkItemDeps,
} from "./application/resolve-work-item";
export { resolveWorkItemCommand } from "./application/resolve-work-item";

export type {
  IngestSourceWebhookInput,
  IngestSourceWebhookDeps,
} from "./application/ingest-source-webhook";
export { ingestSourceWebhookCommand } from "./application/ingest-source-webhook";

export type {
  RebuildWorkStatusInput,
  RebuildWorkStatusDeps,
} from "./application/rebuild-work-status";
export { rebuildWorkStatusCommand } from "./application/rebuild-work-status";

export type {
  NormalizedSourceCheck,
  NormalizedSourceComment,
  SourceChecksResult,
  SourceCheckStatus,
} from "./domain/write-types";

export {
  defaultSourceAdapters,
  ensureProjectRepositorySource,
  GenericWebhookIngestor,
  SourceSyncService,
  type SourceSyncSummary,
} from "./infrastructure/source-sync";

export {
  ForgejoSourceAdapter,
  GenericWebhookSourceAdapter,
  GitHubSourceAdapter,
  GitLabSourceAdapter,
} from "./infrastructure/providers";

export {
  parseRepositoryRemote,
  providerBaseUrl,
  type RepositoryIdentity,
} from "./domain/repository";

export { createWorkRepositories } from "./infrastructure/work-repositories";
export type {
  ProjectSource,
  SourceConnection,
  WorkListInput,
  WorkPage,
  WorkRepositories,
} from "./infrastructure/work-repositories";
export { createWorkStatusRollup } from "./infrastructure/work-status-rollup";
export type { WorkStatusRollup } from "./infrastructure/work-status-rollup";
