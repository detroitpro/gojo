/**
 * Browser-safe entry: type-only exports, no Zod runtime.
 * Prefer `import type { … } from "@gojo/contracts/types"`.
 */
export type {
  ApiErrorBody,
  ApiErrorCode,
  ApiErrorResponse,
  PaginationMeta,
} from "./src/api";

export type {
  Approval,
  ApprovalAutonomy,
  ApprovalState,
  ChecksState,
  ControlIntent,
  CreateApproval,
  ReviewVerdict,
  SubmitControlIntent,
} from "./src/approvals";

export type {
  CreatePlatformChangeEventInput,
  PlatformChangeEvent,
  PlatformEventTopic,
} from "./src/events";

export type {
  AgentHandoffReport,
  HandoffImpactCategory,
  HandoffImpactItem,
  HandoffStatus,
  HandoffSubjectActions,
  NormalizedHandoff,
} from "./src/handoff";

export type { RunTrigger } from "./src/run-trigger";

export type { RunState } from "./src/run-states";

export { TERMINAL_RUN_STATES, isTerminalRunState } from "./src/run-terminal";

export type { SchedulingPolicy } from "./src/scheduling";

export type {
  SourceSyncState,
  WorkAttention,
  WorkDelivery,
  WorkExecution,
  WorkItem,
  WorkOutcome,
  WorkProvenance,
  WorkRecheckResult,
  WorkRecheckStatus,
  WorkResolution,
  WorkStatusCompareWindow,
  WorkStatusCounts,
} from "./src/work";

export type {
  ClientFrame,
  RunEvent,
  RunEventCursor,
  ServerFrame,
  WsHttpMethod,
} from "./src/ws";

export type {
  AgentConfig,
  AgentEnvironment,
  AgentIntegration,
  ProfileConfig,
  ProjectConfig,
  ProjectManifest,
  ScheduleConfig,
  ValidationProfile,
} from "./src/manifest";

export type {
  NotificationChannelConfig,
  NotificationChannelMap,
  NotificationChannelType,
} from "./src/notifications";


export type {
  Agent,
  Attempt,
  AttemptState,
  Profile,
  Project,
  Run,
  RunImpactItem,
  RunImpactSource,
  RunImpactVerification,
  RunIntegration,
  RunIntegrationStatus,
  Schedule,
  UserRole,
} from "./src/entities";

export {
  AGENT_SORT_ALLOWED,
  BACKUP_SORT_ALLOWED,
  IMPACT_ITEM_SORT_ALLOWED,
  INTEGRATION_LIST_STATUSES,
  INTEGRATION_SORT_ALLOWED,
  PROJECT_SORT_ALLOWED,
  QUEUE_SORT_ALLOWED,
  RUN_SORT_ALLOWED,
  SCHEDULE_SORT_ALLOWED,
  TOKEN_SORT_ALLOWED,
} from "./src/list-api";
export type {
  ImpactItemListRow,
  IntegrationListItem,
  IntegrationListStatus,
  ProjectSummaryCounts,
} from "./src/list-api";

export { parseImpactRange } from "./src/dashboard";
export type {
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
  QueueRunningItem,
  QueueSnapshot,
  QueueWaitingItem,
} from "./src/dashboard";

export type {
  AdapterInfo,
  AdapterTestResult,
  ApiTokenInfo,
  BackupInfo,
  BrowseRoot,
  CookieSecureMode,
  CreatedApiToken,
  DirectoryEntry,
  DirectoryListing,
  DoctorToolCheck,
  HealthInfo,
  InstanceDoctorResult,
  InstanceInfo,
  InstanceNetworkDoctor,
  NotificationChannelEntry,
  ProjectBaseCheckout,
  ProjectDoctorResult,
  ProjectSyncResult,
  ProjectValidationToolCheck,
  ProjectWorkspaceFilesCheck,
  RunArtifactsResult,
  RunDiffResult,
  User,
} from "./src/ops-access";
