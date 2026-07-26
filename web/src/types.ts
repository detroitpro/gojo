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

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  remoteUrl: string | null;
  defaultBranch: string;
  manifestJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  projectId: string;
  taskId: string;
  scheduleId: string | null;
  state: RunState;
  idempotencyKey: string;
  trigger: RunTrigger;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  /** Present on list/detail API responses */
  projectName?: string | null;
  taskName?: string | null;
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
  taskId: string;
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
  taskName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  /** Human-readable cron from list API */
  cronDescription?: string | null;
}

export interface UpcomingScheduleSeries {
  id: string;
  name: string;
  taskName: string | null;
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

export interface AgentInfo {
  name: string;
  installed: boolean;
  version?: string;
  authenticated?: boolean;
}

export interface DashboardStats {
  projects: number;
  tasks: number;
  schedules: number;
  runs: number;
  activeRuns: number;
  paused: boolean;
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

export interface Task {
  id: string;
  projectId: string;
  name: string;
  description: string;
  agentProfileId: string | null;
  prompt: string;
  validationProfileJson: string;
  integrationJson: string;
  failurePolicyJson: string;
  concurrencyJson: string;
  enabled: boolean;
  createdAt: string;
  /** Present on list API responses */
  projectName?: string | null;
  agentProfileName?: string | null;
  lastRunId?: string | null;
  lastRunState?: string | null;
  lastRunCreatedAt?: string | null;
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
  task: string;
  step: string;
  binary: string;
  found: boolean;
  path?: string;
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
  agents: AgentInfo[];
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

export interface AgentTestResult {
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

export interface RunEvent {
  id?: number;
  type: string;
  runId: string;
  at: string;
  data?: unknown;
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
