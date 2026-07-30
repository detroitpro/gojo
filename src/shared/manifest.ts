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

/**
 * Filesystem/shell/network permissions on a profile (formerly on the top-level
 * agent config). Retained shape and enum values from the previous
 * `AgentPermissions` since profiles carry adapter execution permissions.
 */
export const ProfilePermissionsSchema = z.object({
  filesystem: z.enum(['project', 'read-only', 'none']).optional(),
  shell: z.enum(['allowlisted', 'none', 'full']).optional(),
  network: z.enum(['restricted', 'none', 'full']).optional(),
});

export type ProfilePermissions = z.infer<typeof ProfilePermissionsSchema>;

/**
 * Adapter/model/permissions for an agent runtime. Formerly `AgentConfig` before
 * the Tasks→Agents vocabulary rebrand; the previous top-level `agents:` map is
 * now `profiles:` and describes how an adapter is invoked.
 */
export const ProfileConfigSchema = z.object({
  adapter: z.string().min(1),
  model: z.string().optional(),
  timeout: z.string().optional(),
  readOnly: z.boolean().optional(),
  permissions: ProfilePermissionsSchema.optional(),
});

export type ProfileConfig = z.infer<typeof ProfileConfigSchema>;

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

export const AgentConcurrencySchema = z.object({
  projectLimit: z.number().int().positive().optional(),
  overlapPolicy: z.enum(['skip', 'queue', 'cancel']).optional(),
});

export type AgentConcurrency = z.infer<typeof AgentConcurrencySchema>;

export const PrToolSchema = z.enum(['gh', 'tea']);

export type PrTool = z.infer<typeof PrToolSchema>;

export const AgentIntegrationSchema = z.object({
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

export type AgentIntegration = z.infer<typeof AgentIntegrationSchema>;

export const AgentFailurePolicySchema = z.object({
  maxAttemptsPerRun: z.number().int().positive().optional(),
  disableAfterConsecutiveFailedRuns: z.number().int().positive().optional(),
  backoff: z.enum(['exponential', 'linear', 'none']).optional(),
});

export type AgentFailurePolicy = z.infer<typeof AgentFailurePolicySchema>;

export const AgentSelfHealSchema = z.object({
  /** Name of the in-repo healer agent to enqueue on failure. */
  agent: z.string().min(1),
  /** Fire healer after this many consecutive failed runs (default 1). */
  afterConsecutiveFailedRuns: z.number().int().positive().optional(),
});

export type AgentSelfHeal = z.infer<typeof AgentSelfHealSchema>;

export const NotificationsConfigSchema = z.object({
  onSuccess: z.array(z.string()).optional(),
  onFailure: z.array(z.string()).optional(),
  onDisabled: z.array(z.string()).optional(),
});

export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;

/** Safe-parse variant for routing stored outside a full manifest (e.g. an agent row). */
export function safeParseNotificationsConfig(input: unknown) {
  return NotificationsConfigSchema.safeParse(input);
}

/**
 * A work unit definition. Formerly `TaskConfig` before the Tasks→Agents
 * vocabulary rebrand; `agent` here refers to the profile name (adapter+model)
 * from the top-level `profiles:` map.
 */
export const AgentConfigSchema = z.object({
  description: z.string().min(1),
  /** Name of the entry in `profiles:` that provides the adapter/model. */
  profile: z.string().min(1),
  promptFile: z.string().min(1),
  validationProfile: z.string().min(1),
  concurrency: AgentConcurrencySchema.optional(),
  integration: AgentIntegrationSchema.optional(),
  failurePolicy: AgentFailurePolicySchema.optional(),
  selfHeal: AgentSelfHealSchema.optional(),
  /** Overrides project-level routing for this agent only. */
  notifications: NotificationsConfigSchema.optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ScheduleConfigSchema = z.object({
  /** Name of the entry in `agents:` this schedule fires. */
  agent: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1),
});

export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

/** Repository project YAML manifest per PRD §8 (Tasks→Agents vocabulary). */
export const ProjectManifestSchema = z.object({
  version: ManifestVersionSchema,
  project: ProjectConfigSchema,
  repository: RepositoryConfigSchema,
  instructions: InstructionsConfigSchema.optional(),
  /** Adapter+model configurations (was top-level `agents:` pre-rebrand). */
  profiles: z.record(ProfileConfigSchema),
  validationProfiles: z.record(ValidationProfileSchema),
  /** Work-unit definitions (was top-level `tasks:` pre-rebrand). */
  agents: z.record(AgentConfigSchema),
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
