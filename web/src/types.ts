export type RunState =
  | "Scheduled"
  | "Queued"
  | "Preparing"
  | "Running"
  | "Validating"
  | "AwaitingApproval"
  | "Integrating"
  | "Reporting"
  | "Succeeded"
  | "Failed"
  | "Canceled"
  | "TimedOut"
  | "Skipped"
  | "Superseded"
  | "Abandoned"
  | "Blocked"
  | "Conflict"
  | "InfrastructureFailure";

export type RunTrigger = "schedule" | "manual" | "api" | "web" | "heal";

export interface User {
  id: string;
  username: string;
  role: string;
}

export type {
  PlatformChangeEvent,
  PlatformEventTopic,
} from "@shared/events";
export type { RunEvent } from "@shared/ws";

export interface ProjectSummaryCounts {
  agentCount: number;
  enabledAgentCount: number;
  scheduleCount: number;
  enabledScheduleCount: number;
  hasManifest: boolean;
  /** Source-verified open PRs; stale last-known-open work is excluded. */
  openPrCount: number;
}

export type WorkExecution =
  | "queued"
  | "preparing"
  | "running"
  | "validating"
  | "awaiting-approval"
  | "integrating"
  | "reporting"
  | "terminal"
  | "none";
export type WorkDelivery =
  | "none"
  | "draft"
  | "open"
  | "review"
  | "blocked"
  | "merged"
  | "closed";
export type WorkAttention = "none" | "approval" | "blocked" | "sync-error" | "stale";
export type SourceSyncState =
  | "pending"
  | "syncing"
  | "current"
  | "stale"
  | "error"
  | "unsupported";

export type WorkResolution = "operator";
export type WorkRecheckStatus = "active" | "terminal" | "unresolved";

export interface WorkItem {
  id: string;
  projectId: string;
  sourceId: string | null;
  kind: string;
  nativeKey: string | null;
  title: string;
  summary: string;
  execution: WorkExecution;
  delivery: WorkDelivery;
  outcome: "pending" | "succeeded" | "failed" | "no-change" | "canceled";
  attention: WorkAttention;
  provenance: "gojo-agent" | "human" | "bot" | "external";
  actorName: string | null;
  profileId?: string | null;
  labels: string[];
  nativeState: string | null;
  webUrl: string | null;
  observedAt: string | null;
  nextSyncAt: string | null;
  syncState: SourceSyncState;
  lastError: string | null;
  resolution: WorkResolution | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Durable agent name for runs, or delivering run agent for forge rows. */
  agentName?: string | null;
  /** Profile/adapter/actor label attribution. */
  agentLabel?: string | null;
  /** Outbound delivers targets (PRs/issues) when returned from list APIs. */
  deliveredWork?: WorkItem[];
}

export interface WorkRecheckResult {
  status: WorkRecheckStatus;
  work: WorkItem;
  detail: string | null;
}

export type WorkStatusCompareWindow = "24h" | "7d" | "30d";

export interface WorkStatusCounts {
  working: number;
  queued: number;
  needsAttention: number;
  verifiedOpen: number;
  staleOpen: number;
}

export interface WorkStatus extends WorkStatusCounts {
  asOf: string | null;
  previous: WorkStatusCounts | null;
  previousAsOf: string | null;
  compareWindow: WorkStatusCompareWindow;
}

export interface ProjectSource {
  id: string;
  projectId: string;
  connectionId: string | null;
  kind: string;
  externalKey: string;
  displayName: string;
  webUrl: string | null;
  syncState: SourceSyncState;
  observedAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  connection: {
    id: string;
    name: string;
    adapter: string;
    capabilities: { workKinds: string[] };
  } | null;
}

/** List filter for GET /integrations (not always equal to row.status). */
export type IntegrationListStatus = "open" | "merged" | "committed";

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
  /** Actual run_integrations.status. */
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

export interface Project extends ProjectSummaryCounts {
  id: string;
  name: string;
  repoPath: string;
  remoteUrl: string | null;
  defaultBranch: string;
  /** Present on detail/get; omitted from list responses. */
  manifestJson?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSyncResult {
  manifestPath: string | null;
  profiles: number;
  agents: number;
  schedules: number;
}

export interface ProjectSyncResponse {
  project: Project;
  sync: ProjectSyncResult;
}

export interface Run {
  id: string;
  projectId: string;
  agentId: string;
  scheduleId: string | null;
  state: RunState;
  idempotencyKey: string;
  trigger: RunTrigger;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  notBeforeAt?: string | null;
  expiresAt?: string | null;
  admittedAt?: string | null;
  priority?: number;
  workItemId?: string | null;
  /** Present on list/detail API responses */
  projectName?: string | null;
  agentName?: string | null;
}

export interface SchedulingPolicy {
  maxConcurrentRuns: number;
  maxConcurrentRunsPerProject: number;
  minStartIntervalMs: number;
  maxLoadPerCpu: number;
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

export interface Attempt {
  id: string;
  runId: string;
  attemptNumber: number;
  state: string;
  workspacePath: string | null;
  branchName: string | null;
  startingCommit: string | null;
  resultCommit: string | null;
  prUrl: string | null;
  agentVersion: string | null;
  agentAdapter: string | null;
  exitCode: number | null;
  handoffJson: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalCostUsd: number | null;
  costSource: string | null;
  usageJson: string | null;
  model: string | null;
  agentDurationMs: number | null;
}

export interface Schedule {
  id: string;
  agentId: string;
  name: string;
  cronExpr: string;
  timezone: string;
  enabled: boolean;
  overlapPolicy: string;
  missedRunPolicy: string;
  retryJson: string;
  consecutiveFailures: number;
  disableAfter: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  /** Present on list API responses */
  agentName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  /** Human-readable cron from list API */
  cronDescription?: string | null;
}

export interface UpcomingScheduleSeries {
  id: string;
  name: string;
  agentName: string | null;
  timezone: string;
  enabled: boolean;
  color: string;
  fires: string[];
}

export interface SchedulesUpcomingResult {
  horizonHours: number;
  from: string;
  to: string;
  schedules: UpcomingScheduleSeries[];
}

/** Adapter detection result from GET /adapters. */
export interface AdapterInfo {
  name: string;
  installed: boolean;
  version?: string;
  authenticated?: boolean;
}

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
  agents: DashboardOverviewAgent[];
}

export interface DashboardOverview {
  projects: DashboardOverviewProject[];
}

export interface DashboardImpactTotals {
  succeededRuns: number;
  prsOpened: number;
  prsOpen: number;
  mergedRuns: number;
  closedUnmerged: number;
  commits: number;
  mergeRate: number | null;
}

/** Distinct runs that produced impact in a category (dashboard strip). */
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

export type DashboardImpactRange = "30d" | "90d" | "all";

export interface DashboardImpactWindow {
  from: string | null;
  to: string | null;
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

export interface RunImpactItem {
  id: string;
  runId: string;
  attemptId: string | null;
  category: string;
  subject: string;
  summary: string;
  source: string;
  verification: string;
  confidence: number | null;
  evidenceJson: string;
  createdAt: string;
}

export interface RunIntegration {
  id: string;
  runId: string;
  attemptId: string | null;
  mode: string;
  provider: string | null;
  apiUrl: string | null;
  repo: string | null;
  prNumber: number | null;
  prUrl: string | null;
  status: string;
  autoMergeRequested: boolean;
  commitSha: string | null;
  openedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  checkCount: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceInfo {
  bindHost: string;
  bindPort: number;
  paused: boolean;
  telemetryEnabled: boolean;
}

export interface HealthInfo {
  status: string;
  paused: boolean;
  version: string;
}

export interface AgentSource {
  repoPath: string;
  manifestPath: string | null;
  promptFile: string | null;
  promptAbsolutePath: string | null;
}

/** Work unit (previously "Task"): a manifest-defined runnable definition. */
export interface Agent {
  id: string;
  projectId: string;
  name: string;
  description: string;
  profileId: string | null;
  prompt: string;
  validationProfileJson: string;
  integrationJson: string;
  failurePolicyJson: string;
  concurrencyJson: string;
  notificationsJson: string;
  enabled: boolean;
  createdAt: string;
  /** Present on list API responses */
  projectName?: string | null;
  profileName?: string | null;
  lastRunId?: string | null;
  lastRunState?: string | null;
  lastRunCreatedAt?: string | null;
  /** Present on list API: up to 5 recent runs, oldest → newest. */
  recentRuns?: DashboardOverviewRun[];
  /** Present on GET /agents/:id */
  source?: AgentSource;
}

/** YAML profile (adapter+model config). Previously called `AgentProfile`. */
export interface Profile {
  id: string;
  projectId: string | null;
  name: string;
  adapter: string;
  configJson: string;
  createdAt: string;
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface CreatedApiToken extends ApiTokenInfo {
  token: string;
}

export interface ProjectBaseCheckout {
  clean: boolean;
  dirtyFiles: string[];
  behindOrigin: number | null;
}

export interface ProjectValidationToolCheck {
  agent: string;
  step: string;
  binary: string;
  found: boolean;
  path?: string;
  shellBuiltin?: boolean;
}

export interface ProjectDoctorResult {
  projectId: string;
  repoExists: boolean;
  manifest: boolean;
  baseCheckout: ProjectBaseCheckout;
  validationTools: ProjectValidationToolCheck[];
}

export interface DoctorToolCheck {
  name: string;
  found: boolean;
  path?: string;
}

export interface InstanceDoctorResult {
  git: boolean;
  disk: boolean;
  database: boolean;
  /** Adapter detection info; backend field name is still `agents`. */
  agents: AdapterInfo[];
  home: string;
  daemonPath: string;
  tools: DoctorToolCheck[];
  binaryStale: boolean;
  binaryStatus: {
    stale: boolean;
    detail: string | null;
    exePath: string | null;
  };
  warnings: string[];
}

export interface AdapterTestResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  canceled: boolean;
  version?: string;
}

export interface RunDiffResult {
  files: string[];
}

export interface RunArtifactsResult {
  path: string;
  exists: boolean;
  handoff: unknown | null;
  validation: unknown | null;
  failure: unknown | null;
}

export interface BackupInfo {
  path: string;
  name: string;
  size: number;
  createdAt: string;
}

export type NotificationChannelType =
  | "slack"
  | "webhook"
  | "discord"
  | "teams"
  | "telegram";

export type NotificationChannelConfig =
  | {
      type: "slack" | "webhook" | "discord" | "teams";
      webhookUrl: string;
      config?: Record<string, unknown>;
    }
  | {
      type: "telegram";
      botToken: string;
      chatId: string;
      config?: Record<string, unknown>;
    };

export type NotificationChannelMap = Record<string, NotificationChannelConfig>;

export type NotificationChannelEntry = NotificationChannelConfig & {
  name: string;
};

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
  isGitRepo: boolean;
}

export interface BrowseRoot {
  label: string;
  path: string;
}

export interface ValidationStepEventData {
  name: string;
  command: string;
  exitCode: number | null;
  status: "passed" | "failed" | "timed_out" | "canceled" | string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AgentOutputEventData {
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface AgentUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCostUsd: number | null;
  costSource: string;
  model?: string;
}

export interface AgentFinishedEventData {
  exitCode: number;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  usage?: AgentUsageSummary | null;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}
