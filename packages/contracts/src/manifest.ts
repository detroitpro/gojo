import { z } from 'zod';

export const ManifestVersionSchema = z.literal(1);

export type ManifestVersion = z.infer<typeof ManifestVersionSchema>;

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  defaultBranch: z.string().min(1),
  /** When false, Sync gates all new work for the project. Omitted ⇒ true. */
  enabled: z.boolean().default(true),
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

/**
 * Project-level source connection overrides. Use `apiUrl` when the forge API
 * is not reachable at the URL derived from the git remote host (common for
 * self-hosted Forgejo on a non-443 port or plain HTTP).
 */
export const SourceConfigSchema = z.object({
  apiUrl: z.string().url().optional(),
});

export type SourceConfig = z.infer<typeof SourceConfigSchema>;

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
/** Duration grammar shared with runtime `parseTimeout` (`ms`|`s`|`m`|`h`). */
const DurationStringSchema = z
  .string()
  .regex(
    /^(\d+(?:\.\d+)?)(ms|s|m|h)$/,
    'Invalid timeout format (expected e.g. 30s, 10m, 1h)',
  );

export const ProfileConfigSchema = z.object({
  adapter: z.string().min(1),
  model: z.string().optional(),
  timeout: DurationStringSchema.optional(),
  readOnly: z.boolean().optional(),
  permissions: ProfilePermissionsSchema.optional(),
});

export type ProfileConfig = z.infer<typeof ProfileConfigSchema>;

export const ValidationStepSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  timeout: DurationStringSchema.optional(),
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

const PostApprovalModeSchema = z.enum(['commit-only', 'pull-request', 'auto-merge']);

export const AgentIntegrationSchema = z
  .object({
    mode: z.enum(['commit-only', 'pull-request', 'auto-merge', 'await-approval']),
    targetBranch: z.string().min(1),
    requireAllValidations: z.boolean().optional(),
    /** Integration mode used after an operator approves an await-approval run. */
    postApprovalMode: PostApprovalModeSchema.optional(),
    /** Authority required before the platform may merge an agent-authored PR. */
    approval: z.enum(['manual', 'reviewer', 'auto']).optional(),
    /** Labels that opt a linked source issue into a stronger authority policy. */
    autonomyLabels: z
      .object({
        auto: z.string().min(1),
      })
      .optional(),
    /** Maximum automated repair rounds after red CI or requested changes. */
    fixRounds: z.number().int().min(0).optional(),
    /**
     * CLI used when `mode` is `pull-request`.
     * `gh` = GitHub CLI; `tea` = Gitea/Forgejo tea CLI. Default: `gh`.
     */
    prTool: PrToolSchema.optional(),
    /** Tea `--login` (Forgejo/Gitea account alias). Ignored for `gh`. */
    prLogin: z.string().min(1).optional(),
    /** Tea `--remote` for host discovery. Ignored for `gh`. Default at runtime: `origin`. */
    prRemote: z.string().min(1).optional(),
    /** Forgejo/Gitea base URL (e.g. `http://192.168.5.251:3001`). */
    prApiUrl: z.string().url().optional(),
    /** Forgejo repo slug `owner/name`. */
    prRepo: z.string().min(3).optional(),
    /** Platform / native forge merge style. Default: squash. */
    prMergeStyle: z.enum(['squash', 'merge', 'rebase']).optional(),
    /**
     * When true (pull-request mode only), ask the forge to merge once checks
     * succeed (Forgejo/GitHub/GitLab native auto-merge). Skips the reviewer
     * agent; approval autonomy becomes `auto`.
     */
    prAutoMerge: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.prAutoMerge && value.mode !== 'pull-request') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'prAutoMerge requires integration.mode pull-request',
        path: ['prAutoMerge'],
      });
    }
  });

export type AgentIntegration = z.infer<typeof AgentIntegrationSchema>;

export const IssueLabelTriggerSchema = z.object({
  on: z.literal('issue-label'),
  requireLabels: z.array(z.string().min(1)).min(1),
  anyLabels: z.array(z.string().min(1)).min(1).optional(),
  excludeLabels: z.array(z.string().min(1)).optional(),
  /** Only these source-native actors may apply the authorizing label. */
  trustedActors: z.array(z.string().min(1)).min(1),
  maxOpenClaims: z.number().int().positive(),
});

export const PullRequestChecksSettledTriggerSchema = z.object({
  on: z.literal('pull-request-checks-settled'),
  fromAgents: z.array(z.string().min(1)).min(1),
});

export const AgentTriggerSchema = z.discriminatedUnion('on', [
  IssueLabelTriggerSchema,
  PullRequestChecksSettledTriggerSchema,
]);

export type AgentTrigger = z.infer<typeof AgentTriggerSchema>;

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
  onApprovalNeeded: z.array(z.string()).optional(),
});

export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;

/** Safe-parse variant for routing stored outside a full manifest (e.g. an agent row). */
export function safeParseNotificationsConfig(input: unknown) {
  return NotificationsConfigSchema.safeParse(input);
}

/**
 * Per-agent dotenv loading from the registered primary repository checkout.
 * Values are selected by `include` only; `required` must be a subset of
 * `include`. Paths must be repo-relative (never absolute).
 */
export const AgentEnvironmentSchema = z
  .object({
    file: z
      .string()
      .min(1)
      .refine((value) => !value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value), {
        message: 'environment.file must be a repository-relative path',
      }),
    include: z.array(z.string().min(1)).min(1),
    required: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.required) {
      return;
    }
    const include = new Set(value.include);
    for (const key of value.required) {
      if (!include.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `environment.required key "${key}" must also appear in environment.include`,
          path: ['required'],
        });
      }
    }
  });

export type AgentEnvironment = z.infer<typeof AgentEnvironmentSchema>;

/**
 * Which sibling agents' PR heads a merge/babysit agent may touch.
 * Resolved at runtime to `gojo/run/<agent>/…` prefixes — do not duplicate
 * branch lists in prompt files.
 */
export const AgentMergePolicySchema = z.object({
  /**
   * `"*"` = every enabled agent in the project (minus this agent and
   * `excludeAgents`). Otherwise an explicit list of agent names.
   */
  includeAgents: z.union([
    z.literal('*'),
    z.array(z.string().min(1)).min(1),
  ]),
  /** Always excluded, even when `includeAgents` is `"*"`. */
  excludeAgents: z.array(z.string().min(1)).optional(),
});

export type AgentMergePolicy = z.infer<typeof AgentMergePolicySchema>;

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
  /** When false, Sync disables this agent. Omitted ⇒ true. Ops toggles until next Sync. */
  enabled: z.boolean().default(true),
  concurrency: AgentConcurrencySchema.optional(),
  trigger: AgentTriggerSchema.optional(),
  integration: AgentIntegrationSchema.optional(),
  failurePolicy: AgentFailurePolicySchema.optional(),
  selfHeal: AgentSelfHealSchema.optional(),
  /**
   * When set, gojo injects a **Gojo merge scope** section listing allowed
   * `gojo/run/<agent>/…` head prefixes derived from sibling agents.
   */
  mergePolicy: AgentMergePolicySchema.optional(),
  /** Overrides project-level routing for this agent only. */
  notifications: NotificationsConfigSchema.optional(),
  /**
   * Load allowlisted variables from a dotenv file in the primary checkout
   * (worktrees omit gitignored files). Injected into agent + validation only.
   */
  environment: AgentEnvironmentSchema.optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ScheduleConfigSchema = z.object({
  /** Name of the entry in `agents:` this schedule fires. */
  agent: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1),
  /** When false, Sync disables this schedule. Omitted ⇒ true. Ops toggles until next Sync. */
  enabled: z.boolean().default(true),
});

export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

/** Repository project YAML manifest per PRD §8 (Tasks→Agents vocabulary). */
export const ProjectManifestSchema = z.object({
  version: ManifestVersionSchema,
  project: ProjectConfigSchema,
  repository: RepositoryConfigSchema,
  /** Overrides for the repository source connection derived from the remote. */
  source: SourceConfigSchema.optional(),
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
