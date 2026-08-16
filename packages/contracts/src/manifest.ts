import { z } from 'zod';

export const ManifestVersionSchema = z
  .literal(1)
  .describe('Manifest format version. Must be 1.');

export type ManifestVersion = z.infer<typeof ManifestVersionSchema>;

export const ProjectConfigSchema = z
  .object({
    name: z.string().min(1).describe('Human-readable project name.'),
    defaultBranch: z
      .string()
      .min(1)
      .describe('Git default branch used as the integration base (e.g. main).'),
    /** When false, Sync gates all new work for the project. Omitted ⇒ true. */
    enabled: z
      .boolean()
      .default(true)
      .describe('When false, Sync gates all new work for the project. Omitted ⇒ true.'),
  })
  .describe('Project identity and enablement.');

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const RepositoryConfigSchema = z
  .object({
    remote: z
      .string()
      .min(1)
      .describe('Git remote name used for fetch/push (usually origin).'),
    syncBeforeRun: z
      .boolean()
      .describe('Fetch and fast-forward the base, then re-sync the manifest before each run.'),
    requireCleanBase: z
      .boolean()
      .describe('Refuse runs when the primary checkout base is dirty.'),
    submodules: z.boolean().describe('Initialize and update git submodules when preparing worktrees.'),
    gitLfs: z.boolean().describe('Pull Git LFS objects when preparing worktrees.'),
  })
  .describe('Git repository sync and worktree preparation options.');

export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>;

/**
 * Project-level source connection overrides. Use `apiUrl` when the forge API
 * is not reachable at the URL derived from the git remote host (common for
 * self-hosted Forgejo on a non-443 port or plain HTTP).
 */
export const SourceConfigSchema = z
  .object({
    apiUrl: z
      .string()
      .url()
      .optional()
      .describe(
        'Forge API base URL when it differs from the git remote host (self-hosted Forgejo/Gitea).',
      ),
  })
  .describe('Overrides for the repository source connection derived from the remote.');

export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export const InstructionsConfigSchema = z
  .object({
    files: z
      .array(z.string())
      .optional()
      .describe('Repo-relative markdown files prepended to every agent prompt.'),
    scheduledRunNotice: z
      .string()
      .optional()
      .describe('Extra notice injected for scheduled (cron) runs.'),
  })
  .describe('Shared prompt instructions for all agents in the project.');

export type InstructionsConfig = z.infer<typeof InstructionsConfigSchema>;

/**
 * Filesystem/shell/network permissions on a profile (formerly on the top-level
 * agent config). Retained shape and enum values from the previous
 * `AgentPermissions` since profiles carry adapter execution permissions.
 */
export const ProfilePermissionsSchema = z
  .object({
    filesystem: z
      .enum(['project', 'read-only', 'none'])
      .optional()
      .describe('Filesystem access granted to the adapter.'),
    shell: z
      .enum(['allowlisted', 'none', 'full'])
      .optional()
      .describe('Shell execution policy for the adapter.'),
    network: z
      .enum(['restricted', 'none', 'full'])
      .optional()
      .describe('Network access policy for the adapter.'),
  })
  .describe('Adapter execution permissions on a profile.');

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
  )
  .describe('Duration string: <number>(ms|s|m|h), e.g. 30s, 10m, 1h.');

export const ProfileConfigSchema = z
  .object({
    adapter: z
      .string()
      .min(1)
      .describe('Installed adapter id (shell, cursor, claude-code, …).'),
    model: z.string().optional().describe('Model id passed to the adapter when applicable.'),
    timeout: DurationStringSchema.optional().describe('Wall-clock timeout for adapter execution.'),
    readOnly: z.boolean().optional().describe('When true, the adapter must not modify the worktree.'),
    permissions: ProfilePermissionsSchema.optional(),
  })
  .describe('Adapter + model + permissions binding referenced by agents.');

export type ProfileConfig = z.infer<typeof ProfileConfigSchema>;

export const ValidationStepSchema = z
  .object({
    name: z.string().min(1).describe('Step label shown in run activity.'),
    command: z.string().min(1).describe('Shell command run in the worktree.'),
    timeout: DurationStringSchema.optional().describe('Per-step timeout override.'),
  })
  .describe('One command in a validation profile.');

export type ValidationStep = z.infer<typeof ValidationStepSchema>;

export const ValidationProfileSchema = z
  .object({
    steps: z
      .array(ValidationStepSchema)
      .min(1)
      .describe('Ordered validation commands; all must succeed when required.'),
  })
  .describe('Named set of validation steps referenced by agents.');

export type ValidationProfile = z.infer<typeof ValidationProfileSchema>;

export const AgentConcurrencySchema = z
  .object({
    projectLimit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Max concurrent runs for this agent within the project.'),
    overlapPolicy: z
      .enum(['skip', 'queue', 'cancel'])
      .optional()
      .describe('What to do when a new run would overlap an in-flight run.'),
  })
  .describe('Per-agent concurrency controls.');

export type AgentConcurrency = z.infer<typeof AgentConcurrencySchema>;

export const PrToolSchema = z
  .enum(['gh', 'tea'])
  .describe('CLI used to open pull requests: gh (GitHub) or tea (Gitea/Forgejo).');

export type PrTool = z.infer<typeof PrToolSchema>;

const PostApprovalModeSchema = z
  .enum(['commit-only', 'pull-request', 'auto-merge'])
  .describe('Integration mode applied after an operator approves an await-approval run.');

export const AgentIntegrationSchema = z
  .object({
    mode: z
      .enum(['commit-only', 'pull-request', 'auto-merge', 'await-approval'])
      .describe('How successful work is integrated back to the forge.'),
    targetBranch: z
      .string()
      .min(1)
      .describe('Branch that receives commits or is the PR base.'),
    requireAllValidations: z
      .boolean()
      .optional()
      .describe('When true, all validation steps must pass before integration.'),
    /** Integration mode used after an operator approves an await-approval run. */
    postApprovalMode: PostApprovalModeSchema.optional(),
    /** Authority required before the platform may merge an agent-authored PR. */
    approval: z
      .enum(['manual', 'reviewer', 'auto'])
      .optional()
      .describe('Authority required before the platform may merge an agent-authored PR.'),
    /** Labels that opt a linked source issue into a stronger authority policy. */
    autonomyLabels: z
      .object({
        auto: z
          .string()
          .min(1)
          .describe('Issue label that raises autonomy to auto-merge authority.'),
      })
      .optional()
      .describe('Labels that opt a linked source issue into a stronger authority policy.'),
    /** Maximum automated repair rounds after red CI or requested changes. */
    fixRounds: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Maximum automated repair rounds after red CI or requested changes.'),
    /**
     * CLI used when `mode` is `pull-request`.
     * `gh` = GitHub CLI; `tea` = Gitea/Forgejo tea CLI. Default: `gh`.
     */
    prTool: PrToolSchema.optional(),
    /** Tea `--login` (Forgejo/Gitea account alias). Ignored for `gh`. */
    prLogin: z
      .string()
      .min(1)
      .optional()
      .describe('Tea --login account alias (Forgejo/Gitea). Ignored for gh.'),
    /** Tea `--remote` for host discovery. Ignored for `gh`. Default at runtime: `origin`. */
    prRemote: z
      .string()
      .min(1)
      .optional()
      .describe('Tea --remote for host discovery. Ignored for gh. Default: origin.'),
    /** Forgejo/Gitea base URL (e.g. `http://192.168.5.251:3001`). */
    prApiUrl: z
      .string()
      .url()
      .optional()
      .describe('Forgejo/Gitea API base URL when not discoverable from the remote.'),
    /** Forgejo repo slug `owner/name`. */
    prRepo: z
      .string()
      .min(3)
      .optional()
      .describe('Forgejo/Gitea repository slug owner/name.'),
    /** Platform / native forge merge style. Default: squash. */
    prMergeStyle: z
      .enum(['squash', 'merge', 'rebase'])
      .optional()
      .describe('Merge style for platform or native forge merge. Default: squash.'),
    /**
     * When true (pull-request mode only), ask the forge to merge once checks
     * succeed (Forgejo/GitHub/GitLab native auto-merge). Skips the reviewer
     * agent; approval autonomy becomes `auto`.
     */
    prAutoMerge: z
      .boolean()
      .optional()
      .describe(
        'Pull-request mode only: request native forge auto-merge when checks succeed.',
      ),
  })
  .superRefine((value, ctx) => {
    if (value.prAutoMerge && value.mode !== 'pull-request') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'prAutoMerge requires integration.mode pull-request',
        path: ['prAutoMerge'],
      });
    }
  })
  .describe('How an agent integrates successful work (commit, PR, approval).');

export type AgentIntegration = z.infer<typeof AgentIntegrationSchema>;

export const IssueLabelTriggerSchema = z
  .object({
    on: z.literal('issue-label').describe('Fire when a trusted actor applies authorizing labels.'),
    requireLabels: z
      .array(z.string().min(1))
      .min(1)
      .describe('All of these labels must be present to authorize the claim.'),
    anyLabels: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('At least one of these labels must also be present when set.'),
    excludeLabels: z
      .array(z.string().min(1))
      .optional()
      .describe('Skip the issue when any of these labels are present.'),
    /** Only these source-native actors may apply the authorizing label. */
    trustedActors: z
      .array(z.string().min(1))
      .min(1)
      .describe('Only these source-native actors may apply the authorizing label.'),
    maxOpenClaims: z
      .number()
      .int()
      .positive()
      .describe('Maximum open claimed issues this agent may hold at once.'),
  })
  .describe('Trigger on issue labels from trusted actors.');

export const PullRequestChecksSettledTriggerSchema = z
  .object({
    on: z
      .literal('pull-request-checks-settled')
      .describe('Fire when checks settle on PRs authored by listed agents.'),
    fromAgents: z
      .array(z.string().min(1))
      .min(1)
      .describe('Agent names whose pull requests this trigger watches.'),
  })
  .describe('Trigger when pull-request checks settle for sibling agents.');

export const AgentTriggerSchema = z
  .discriminatedUnion('on', [
    IssueLabelTriggerSchema,
    PullRequestChecksSettledTriggerSchema,
  ])
  .describe('Event-driven trigger; omit for schedule-only or manual agents.');

export type AgentTrigger = z.infer<typeof AgentTriggerSchema>;

export const AgentFailurePolicySchema = z
  .object({
    maxAttemptsPerRun: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Retry attempts within a single run for transient failures.'),
    disableAfterConsecutiveFailedRuns: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Copy threshold to linked schedules on sync; auto-disable the schedule after this many consecutive failed runs.',
      ),
    backoff: z
      .enum(['exponential', 'linear', 'none'])
      .optional()
      .describe('Backoff strategy between retry attempts.'),
  })
  .describe('Retry and disable policy after failures.');

export type AgentFailurePolicy = z.infer<typeof AgentFailurePolicySchema>;

export const AgentSelfHealSchema = z
  .object({
    /** Name of the in-repo healer agent to enqueue on failure. */
    agent: z
      .string()
      .min(1)
      .describe('Name of the in-repo healer agent to enqueue on failure.'),
    /** Fire healer after this many consecutive failed runs (default 1). */
    afterConsecutiveFailedRuns: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Fire the healer after this many consecutive failed runs (default 1).'),
  })
  .describe('Enqueue a healer agent after consecutive failures.');

export type AgentSelfHeal = z.infer<typeof AgentSelfHealSchema>;

export const NotificationsConfigSchema = z
  .object({
    onSuccess: z
      .array(z.string())
      .optional()
      .describe('Notification channel ids to ping on success.'),
    onFailure: z
      .array(z.string())
      .optional()
      .describe('Notification channel ids to ping on failure.'),
    onDisabled: z
      .array(z.string())
      .optional()
      .describe('Notification channel ids to ping when the agent is disabled.'),
    onApprovalNeeded: z
      .array(z.string())
      .optional()
      .describe('Notification channel ids to ping when approval is required.'),
  })
  .describe('Notification routing by outcome.');

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
      })
      .describe('Repo-relative dotenv path (never absolute).'),
    include: z
      .array(z.string().min(1))
      .min(1)
      .describe('Variable names to load from the dotenv file.'),
    required: z
      .array(z.string().min(1))
      .optional()
      .describe('Subset of include that must be present or the run fails.'),
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
  })
  .describe(
    'Load allowlisted dotenv variables from the primary checkout into agent + validation.',
  );

export type AgentEnvironment = z.infer<typeof AgentEnvironmentSchema>;

/**
 * Which sibling agents' PR heads a merge/babysit agent may touch.
 * Resolved at runtime to `gojo/run/<agent>/…` prefixes — do not duplicate
 * branch lists in prompt files.
 */
export const AgentMergePolicySchema = z
  .object({
    /**
     * `"*"` = every enabled agent in the project (minus this agent and
     * `excludeAgents`). Otherwise an explicit list of agent names.
     */
    includeAgents: z
      .union([z.literal('*'), z.array(z.string().min(1)).min(1)])
      .describe(
        '"*" for every enabled sibling agent (minus self/excludeAgents), or an explicit name list.',
      ),
    /** Always excluded, even when `includeAgents` is `"*"`. */
    excludeAgents: z
      .array(z.string().min(1))
      .optional()
      .describe('Agent names always excluded, even when includeAgents is "*".'),
  })
  .describe(
    'Allowed sibling agent PR head prefixes for merge/babysit agents (injected at runtime).',
  );

export type AgentMergePolicy = z.infer<typeof AgentMergePolicySchema>;

/**
 * A work unit definition. Formerly `TaskConfig` before the Tasks→Agents
 * vocabulary rebrand; `agent` here refers to the profile name (adapter+model)
 * from the top-level `profiles:` map.
 */
export const AgentConfigSchema = z
  .object({
    description: z.string().min(1).describe('Short human description of the work unit.'),
    /** Name of the entry in `profiles:` that provides the adapter/model. */
    profile: z
      .string()
      .min(1)
      .describe('Name of the profiles: entry that provides adapter/model.'),
    promptFile: z
      .string()
      .min(1)
      .describe('Repo-relative path to the agent prompt or script (usually under .gojo/agents/).'),
    validationProfile: z
      .string()
      .min(1)
      .describe('Name of the validationProfiles: entry to run after the agent.'),
    /** When false, Sync disables this agent. Omitted ⇒ true. Ops toggles until next Sync. */
    enabled: z
      .boolean()
      .default(true)
      .describe('When false, Sync disables this agent. Omitted ⇒ true.'),
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
    notifications: NotificationsConfigSchema.optional().describe(
      'Overrides project-level notification routing for this agent only.',
    ),
    /**
     * Load allowlisted variables from a dotenv file in the primary checkout
     * (worktrees omit gitignored files). Injected into agent + validation only.
     */
    environment: AgentEnvironmentSchema.optional(),
  })
  .describe('Work-unit definition: profile, prompt, validation, and policies.');

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ScheduleConfigSchema = z
  .object({
    /** Name of the entry in `agents:` this schedule fires. */
    agent: z.string().min(1).describe('Name of the agents: entry this schedule fires.'),
    cron: z.string().min(1).describe('Cron expression for the schedule.'),
    timezone: z.string().min(1).describe('IANA timezone for the cron expression (e.g. America/New_York).'),
    /** When false, Sync disables this schedule. Omitted ⇒ true. Ops toggles until next Sync. */
    enabled: z
      .boolean()
      .default(true)
      .describe('When false, Sync disables this schedule. Omitted ⇒ true.'),
  })
  .describe('Cron schedule that enqueues a named agent.');

export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

/** Repository project YAML manifest per PRD §8 (Tasks→Agents vocabulary). */
export const ProjectManifestSchema = z
  .object({
    version: ManifestVersionSchema,
    project: ProjectConfigSchema,
    repository: RepositoryConfigSchema,
    /** Overrides for the repository source connection derived from the remote. */
    source: SourceConfigSchema.optional(),
    instructions: InstructionsConfigSchema.optional(),
    /** Adapter+model configurations (was top-level `agents:` pre-rebrand). */
    profiles: z
      .record(ProfileConfigSchema)
      .describe('Named adapter+model configurations referenced by agents.'),
    validationProfiles: z
      .record(ValidationProfileSchema)
      .describe('Named validation step sets referenced by agents.'),
    /** Work-unit definitions (was top-level `tasks:` pre-rebrand). */
    agents: z.record(AgentConfigSchema).describe('Work-unit definitions keyed by agent name.'),
    schedules: z
      .record(ScheduleConfigSchema)
      .optional()
      .describe('Named cron schedules that enqueue agents.'),
    notifications: NotificationsConfigSchema.optional().describe(
      'Default notification routing for agents that omit their own notifications block.',
    ),
  })
  .describe('Repository-root gojo.yaml project manifest.');

export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

/** Parse and validate a manifest object (typically from parsed YAML). */
export function parseProjectManifest(input: unknown): ProjectManifest {
  return ProjectManifestSchema.parse(input);
}

/** Safe-parse variant returning a Zod result. */
export function safeParseProjectManifest(input: unknown) {
  return ProjectManifestSchema.safeParse(input);
}
