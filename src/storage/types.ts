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
  /** Non-secret env config (file + include/required names); never resolved values. */
  environmentJson: string;
  enabled: boolean;
  createdAt: string;
}

export interface CreateAgentInput {
  projectId: string;
  name: string;
  description?: string;
  profileId?: string | null;
  prompt: string;
  validationProfileJson?: string;
  integrationJson?: string;
  failurePolicyJson?: string;
  concurrencyJson?: string;
  notificationsJson?: string;
  environmentJson?: string;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  profileId?: string | null;
  prompt?: string;
  validationProfileJson?: string;
  integrationJson?: string;
  failurePolicyJson?: string;
  concurrencyJson?: string;
  notificationsJson?: string;
  environmentJson?: string;
  enabled?: boolean;
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
}

export interface CreateScheduleInput {
  agentId: string;
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
  agentId: string;
  scheduleId: string | null;
  state: RunState;
  idempotencyKey: string;
  trigger: RunTrigger;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  /** Suggested earliest start (cron fire time). */
  notBeforeAt: string | null;
  /** Drop from queue after this time (next cron occurrence for scheduled runs). */
  expiresAt: string | null;
  admittedAt: string | null;
  priority: number;
  workItemId: string | null;
}

export interface CreateRunInput {
  projectId: string;
  agentId: string;
  scheduleId?: string | null;
  state?: RunState;
  idempotencyKey: string;
  trigger: RunTrigger;
  notBeforeAt?: string | null;
  expiresAt?: string | null;
  priority?: number;
  workItemId?: string | null;
}

export interface UpdateRunInput {
  state?: RunState;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
  admittedAt?: string | null;
  notBeforeAt?: string | null;
  expiresAt?: string | null;
  priority?: number;
  workItemId?: string | null;
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
  /** Real PR URL or `local://pr/<branch>` placeholder after pull-request integrate. */
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

export interface CreateAttemptInput {
  runId: string;
  attemptNumber: number;
  state?: AttemptState;
  workspacePath?: string | null;
  branchName?: string | null;
  startingCommit?: string | null;
  agentAdapter?: string | null;
}

export interface UpdateAttemptInput {
  state?: AttemptState;
  workspacePath?: string | null;
  branchName?: string | null;
  startingCommit?: string | null;
  resultCommit?: string | null;
  prUrl?: string | null;
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

export type RunImpactSource = "agent" | "platform";

/** Trust ladder for impact accounting: claimed < corroborated < verified. */
export type RunImpactVerification = "claimed" | "corroborated" | "verified" | "rejected";

export interface RunImpactItem {
  id: string;
  runId: string;
  attemptId: string | null;
  category: string;
  subject: string;
  summary: string;
  source: RunImpactSource;
  verification: RunImpactVerification;
  confidence: number | null;
  evidenceJson: string;
  createdAt: string;
}

export interface RunImpactItemDraft {
  category: string;
  subject: string;
  summary: string;
  source: RunImpactSource;
  verification: RunImpactVerification;
  confidence?: number | null;
  evidenceJson?: string;
}

export type RunIntegrationStatus =
  | "committed"
  | "open"
  | "merged"
  | "closed"
  | "conflict"
  | "failed"
  | "unknown";

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
  status: RunIntegrationStatus;
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

export interface UpsertRunIntegrationInput {
  runId: string;
  attemptId?: string | null;
  mode: string;
  provider?: string | null;
  apiUrl?: string | null;
  repo?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
  status: RunIntegrationStatus;
  autoMergeRequested?: boolean;
  commitSha?: string | null;
  openedAt?: string | null;
  mergedAt?: string | null;
  closedAt?: string | null;
  nextCheckAt?: string | null;
}

export interface UpdateRunIntegrationInput {
  status?: RunIntegrationStatus;
  mergedAt?: string | null;
  closedAt?: string | null;
  checkCount?: number;
  lastCheckedAt?: string | null;
  nextCheckAt?: string | null;
  lastError?: string | null;
}

export interface Profile {
  id: string;
  projectId: string | null;
  name: string;
  adapter: string;
  configJson: string;
  createdAt: string;
}

export interface CreateProfileInput {
  projectId?: string | null;
  name: string;
  adapter: string;
  configJson?: string;
}
