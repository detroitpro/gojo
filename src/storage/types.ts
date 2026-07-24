import type { RunState } from "@shared/run-states";

export type { RunState };

export type UserRole = "admin" | "operator" | "viewer";

export type AttemptState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "timed_out";

export type RunTrigger = "schedule" | "manual" | "api" | "web" | "heal";

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

export interface CreateProjectInput {
  name: string;
  repoPath: string;
  remoteUrl?: string | null;
  defaultBranch?: string;
  manifestJson?: string;
}

export interface UpdateProjectInput {
  name?: string;
  repoPath?: string;
  remoteUrl?: string | null;
  defaultBranch?: string;
  manifestJson?: string;
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

export interface CreateTaskInput {
  projectId: string;
  name: string;
  description?: string;
  agentProfileId?: string | null;
  prompt: string;
  validationProfileJson?: string;
  integrationJson?: string;
  failurePolicyJson?: string;
  concurrencyJson?: string;
  enabled?: boolean;
}

export interface UpdateTaskInput {
  name?: string;
  description?: string;
  agentProfileId?: string | null;
  prompt?: string;
  validationProfileJson?: string;
  integrationJson?: string;
  failurePolicyJson?: string;
  concurrencyJson?: string;
  enabled?: boolean;
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

export interface CreateScheduleInput {
  taskId: string;
  name: string;
  cronExpr: string;
  timezone?: string;
  enabled?: boolean;
  overlapPolicy?: string;
  missedRunPolicy?: string;
  retryJson?: string;
  disableAfter?: number | null;
  nextRunAt?: string | null;
}

export interface UpdateScheduleInput {
  name?: string;
  cronExpr?: string;
  timezone?: string;
  enabled?: boolean;
  overlapPolicy?: string;
  missedRunPolicy?: string;
  retryJson?: string;
  consecutiveFailures?: number;
  disableAfter?: number | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
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

export interface CreateRunInput {
  projectId: string;
  taskId: string;
  scheduleId?: string | null;
  state?: RunState;
  idempotencyKey: string;
  trigger: RunTrigger;
}

export interface UpdateRunInput {
  state?: RunState;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
}

export interface Attempt {
  id: string;
  runId: string;
  attemptNumber: number;
  state: AttemptState;
  workspacePath: string | null;
  branchName: string | null;
  startingCommit: string | null;
  resultCommit: string | null;
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

export interface CreateAttemptInput {
  runId: string;
  attemptNumber: number;
  state?: AttemptState;
  workspacePath?: string | null;
  branchName?: string | null;
  startingCommit?: string | null;
}

export interface UpdateAttemptInput {
  state?: AttemptState;
  workspacePath?: string | null;
  branchName?: string | null;
  startingCommit?: string | null;
  resultCommit?: string | null;
  agentVersion?: string | null;
  exitCode?: number | null;
  handoffJson?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  totalCostUsd?: number | null;
  costSource?: string | null;
  usageJson?: string | null;
  model?: string | null;
  agentDurationMs?: number | null;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  previousJson: string | null;
  newJson: string | null;
  sourceIp: string | null;
  authMethod: string | null;
  correlationId: string | null;
  success: boolean;
  createdAt: string;
}

export interface CreateAuditEventInput {
  actor: string;
  action: string;
  target: string;
  previousJson?: string | null;
  newJson?: string | null;
  sourceIp?: string | null;
  authMethod?: string | null;
  correlationId?: string | null;
  success?: boolean;
}

export interface SecretRecord {
  id: string;
  name: string;
  projectId: string | null;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSecretInput {
  name: string;
  projectId?: string | null;
  ciphertext: string;
}

export interface AgentProfile {
  id: string;
  projectId: string | null;
  name: string;
  adapter: string;
  configJson: string;
  createdAt: string;
}

export interface CreateAgentProfileInput {
  projectId?: string | null;
  name: string;
  adapter: string;
  configJson?: string;
}
