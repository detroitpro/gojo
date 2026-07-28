import { z } from 'zod';

export const ManifestVersionSchema = z.literal(1);

export type ManifestVersion = z.infer<typeof ManifestVersionSchema>;

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  defaultBranch: z.string().min(1),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const RepositoryConfigSchema = z.object({
  remote: z.string().min(1),
  syncBeforeRun: z.boolean(),
  requireCleanBase: z.boolean(),
  submodules: z.boolean(),
  gitLfs: z.boolean(),
});

export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>;

export const InstructionsConfigSchema = z.object({
  files: z.array(z.string()).optional(),
  scheduledRunNotice: z.string().optional(),
});

export type InstructionsConfig = z.infer<typeof InstructionsConfigSchema>;

export const AgentPermissionsSchema = z.object({
  filesystem: z.enum(['project', 'read-only', 'none']).optional(),
  shell: z.enum(['allowlisted', 'none', 'full']).optional(),
  network: z.enum(['restricted', 'none', 'full']).optional(),
});

export type AgentPermissions = z.infer<typeof AgentPermissionsSchema>;

export const AgentConfigSchema = z.object({
  adapter: z.string().min(1),
  model: z.string().optional(),
  timeout: z.string().optional(),
  readOnly: z.boolean().optional(),
  permissions: AgentPermissionsSchema.optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ValidationStepSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  timeout: z.string().optional(),
});

export type ValidationStep = z.infer<typeof ValidationStepSchema>;

export const ValidationProfileSchema = z.object({
  steps: z.array(ValidationStepSchema).min(1),
});

export type ValidationProfile = z.infer<typeof ValidationProfileSchema>;

export const TaskConcurrencySchema = z.object({
  projectLimit: z.number().int().positive().optional(),
  overlapPolicy: z.enum(['skip', 'queue', 'cancel']).optional(),
});

export type TaskConcurrency = z.infer<typeof TaskConcurrencySchema>;

export const PrToolSchema = z.enum(['gh', 'tea']);

export type PrTool = z.infer<typeof PrToolSchema>;

export const TaskIntegrationSchema = z.object({
  mode: z.enum(['commit-only', 'pull-request', 'auto-merge']),
  targetBranch: z.string().min(1),
  requireAllValidations: z.boolean().optional(),
  /**
   * CLI used when `mode` is `pull-request`.
   * `gh` = GitHub CLI; `tea` = Gitea/Forgejo tea CLI. Default: `gh`.
   */
  prTool: PrToolSchema.optional(),
  /** Tea `--login` (Forgejo/Gitea account alias). Ignored for `gh`. */
  prLogin: z.string().min(1).optional(),
  /** Tea `--remote` for host discovery. Ignored for `gh`. Default at runtime: `origin`. */
  prRemote: z.string().min(1).optional(),
  /**
   * After a successful `tea` PR create, enable Forgejo “merge when checks succeed”
   * via the pulls merge API. Requires `prApiUrl`, `prRepo`, and
   * `GOJO_FORGEJO_TOKEN` or `FORGEJO_TOKEN` in the daemon environment.
   */
  prAutoMerge: z.boolean().optional(),
  /** Forgejo/Gitea base URL (e.g. `http://192.168.5.251:3001`). */
  prApiUrl: z.string().url().optional(),
  /** Forgejo repo slug `owner/name`. */
  prRepo: z.string().min(3).optional(),
  /** Merge style for auto-merge (`Do` field). Default: squash. */
  prMergeStyle: z.enum(['squash', 'merge', 'rebase']).optional(),
});

export type TaskIntegration = z.infer<typeof TaskIntegrationSchema>;

export const TaskFailurePolicySchema = z.object({
  maxAttemptsPerRun: z.number().int().positive().optional(),
  disableAfterConsecutiveFailedRuns: z.number().int().positive().optional(),
  backoff: z.enum(['exponential', 'linear', 'none']).optional(),
});

export type TaskFailurePolicy = z.infer<typeof TaskFailurePolicySchema>;

export const TaskSelfHealSchema = z.object({
  /** Name of the in-repo healer task to enqueue on failure. */
  task: z.string().min(1),
  /** Fire healer after this many consecutive failed runs (default 1). */
  afterConsecutiveFailedRuns: z.number().int().positive().optional(),
});

export type TaskSelfHeal = z.infer<typeof TaskSelfHealSchema>;

export const NotificationsConfigSchema = z.object({
  onSuccess: z.array(z.string()).optional(),
  onFailure: z.array(z.string()).optional(),
  onDisabled: z.array(z.string()).optional(),
});

export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;

/** Safe-parse variant for routing stored outside a full manifest (e.g. a task row). */
export function safeParseNotificationsConfig(input: unknown) {
  return NotificationsConfigSchema.safeParse(input);
}

export const TaskConfigSchema = z.object({
  description: z.string().min(1),
  agent: z.string().min(1),
  promptFile: z.string().min(1),
  validationProfile: z.string().min(1),
  concurrency: TaskConcurrencySchema.optional(),
  integration: TaskIntegrationSchema.optional(),
  failurePolicy: TaskFailurePolicySchema.optional(),
  selfHeal: TaskSelfHealSchema.optional(),
  /** Overrides project-level routing for this task only. */
  notifications: NotificationsConfigSchema.optional(),
});

export type TaskConfig = z.infer<typeof TaskConfigSchema>;

export const ScheduleConfigSchema = z.object({
  task: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1),
});

export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

/** Repository project YAML manifest per PRD §8. */
export const ProjectManifestSchema = z.object({
  version: ManifestVersionSchema,
  project: ProjectConfigSchema,
  repository: RepositoryConfigSchema,
  instructions: InstructionsConfigSchema.optional(),
  agents: z.record(AgentConfigSchema),
  validationProfiles: z.record(ValidationProfileSchema),
  tasks: z.record(TaskConfigSchema),
  schedules: z.record(ScheduleConfigSchema).optional(),
  notifications: NotificationsConfigSchema.optional(),
});

export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

/** Parse and validate a manifest object (typically from parsed YAML). */
export function parseProjectManifest(input: unknown): ProjectManifest {
  return ProjectManifestSchema.parse(input);
}

/** Safe-parse variant returning a Zod result. */
export function safeParseProjectManifest(input: unknown) {
  return ProjectManifestSchema.safeParse(input);
}
