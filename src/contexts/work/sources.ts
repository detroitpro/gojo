/**
 * Compatibility barrel for source adapters / sync (formerly `@/sources`).
 * Prefer importing from `@/contexts/work/contract` for cross-context use.
 */
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
export {
  defaultSourceAdapters,
  ensureProjectRepositorySource,
  GenericWebhookIngestor,
  SourceSyncService,
  type SourceSyncSummary,
} from "./infrastructure/source-sync";
export {
  SourceAdapterRegistry,
  type NormalizedSourceItem,
  type SourceAdapter,
  type SourceGetItemInput,
  type SourceGetItemResult,
  type SourceListInput,
  type SourceListResult,
} from "./ports/source-types";
export type {
  NormalizedSourceCheck,
  NormalizedSourceComment,
  NormalizedSourceLabelActor,
  SourceChecksResult,
  SourceCheckStatus,
  SourceCommentInput,
  SourceItemKind,
  SourceItemOperationInput,
  SourceMergePullRequestInput,
  SourceMergePullRequestResult,
  SourceMergeStyle,
  SourceSetLabelsInput,
} from "./domain/write-types";
