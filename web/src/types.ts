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

export type RunTrigger = "schedule" | "manual" | "api" | "web";

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
  agentVersion: string | null;
  exitCode: number | null;
  handoffJson: string | null;
  startedAt: string | null;
  finishedAt: string | null;
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

export interface ProjectDoctorResult {
  projectId: string;
  repoExists: boolean;
  manifest: boolean;
}

export interface InstanceDoctorResult {
  git: boolean;
  disk: boolean;
  database: boolean;
  agents: AgentInfo[];
  home: string;
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

export interface NotificationChannelConfig {
  type: NotificationChannelType;
  webhookUrl: string;
  config?: Record<string, unknown>;
}

export type NotificationChannelMap = Record<string, NotificationChannelConfig>;

export interface NotificationChannelEntry extends NotificationChannelConfig {
  name: string;
}

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
  type: string;
  runId: string;
  timestamp: string;
  payload?: unknown;
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
