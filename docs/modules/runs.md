# Module: runs

**Path:** `src/contexts/execution/`

## Responsibility

Orchestrates a single run end-to-end: prepare workspace, invoke adapter (with retries), validate, integrate, persist events/artifacts, emit notification hooks, optionally enqueue a project healer.

Primary type: run **coordinator** (`coordinator.ts`). Related:

| File | Role |
|------|------|
| `admission.ts` | Pure `selectAdmissions` — caps, priority, fairness, stagger, load guard, expiry |
| `dispatcher.ts` | `RunDispatcher` — 5s tick + kick on terminal runs; calls `executeRun` for admits |
| `prompt-assembly.ts` | Build adapter prompt: optional `instructions` + agent prompt + validation gate |
| `agent-env.ts` | Allowlisted dotenv load from the primary checkout; merge + redaction helpers |
| `inspect.ts` | Diff / artifacts (`handoff.json`, `validation.json`, `failure.json`) |
| `events.ts` | Live run event bus; semantic events are durably replayed from `work_events` |
| `event-replay.ts` | Namespaced durable/live cursor merge for the WebSocket run channel |
| `failure-policy.ts` | Parse `failure_policy_json` (`maxAttemptsPerRun`, backoff, embedded `selfHeal`) |
| `heal.ts` | Decide whether to enqueue a healer (`trigger=heal`) with loop guards |

## Admission / dispatcher

All trigger paths (scheduler, source work, API, CLI, heal) call `coordinator.enqueueRun` — they do **not** call `executeRun` directly. The dispatcher admits under `SchedulingPolicy` (`packages/contracts/src/scheduling.ts`, stored as `instance_settings.scheduling_policy`):

- Defaults: `maxConcurrentRuns: 2`, `maxConcurrentRunsPerProject: 1`, `minStartIntervalMs: 30000`, `maxLoadPerCpu: 1.0`
- Priority: manual/api/web `10`, source work `15`, heal `20`, schedule `30` (lower first), with round-robin fairness across `projectId`
- API: `GET /api/v1/queue`, `GET|PATCH /api/v1/instance/scheduling`

## List APIs (paging + sort)

Unbounded admin lists (`/runs`, `/agents`, `/schedules`, `/projects`, `/queue` waiting, `/auth/tokens`, `/backups`, `/integrations`) accept `limit`/`offset` plus `sort`/`order` (`asc`|`desc`). Sort keys are whitelisted per resource in `src/infrastructure/persistence/paged-lists.ts` / router memory sorts; unknown `sort` falls back to the resource default. Shared parsers live in `packages/contracts/src/pagination.ts` (`parseSortParams`). Agent lists support `sort=successRate` over the same last-5-run window as the Success column (null/no-history last); default click order is ascending so failing agents surface first.

Gojo-tracked PRs remain available through `GET /api/v1/integrations?status=open|merged|committed` (and `gojo integration list --open|--merged|--committed`) as a compatibility/specialist view. Project summaries and the command center derive open counts from Work: only source-current open/draft/review PRs count as verified open; stale last-known-open work is separate. `GET /api/v1/projects?hasOpenPrs=true` uses the same verified semantics.

Agent enable/disable mirrors schedules: `POST /api/v1/agents/:id/enable|disable`, `gojo agent enable|disable <id>`, and the Agents UI row menu (Run now, View runs, View schedules, Enable/Disable). Manifest sync may still soft-disable agents absent from `gojo.yaml`.

Agent detail (`GET /api/v1/agents/:id`, `gojo agent inspect <id>`, UI `/agents/:id`) is **ops/inspect only**: prompt and policy JSON are read-only snapshots from the last Sync. Edit `gojo.yaml` + `promptFile` in the repo (or via another agent), then Project Sync. The response includes a `source` block (`repoPath`, `manifestPath`, `promptFile`, `promptAbsolutePath`) when the agent appears in the project’s synced manifest. Schedules lists accept `agentId` for linked schedules.

## Prompt assembly

For non-shell adapters, `assembleAgentPrompt` prepends manifest `instructions.scheduledRunNotice` and each `instructions.files` path (read from the **worktree**, fail-fast if missing or path-escapes), then the agent `promptFile` body, validation commands, and the run-scoped progress reporting contract (fleet-wide: progress `title` = current focus, not work identity). Shell adapters skip instructions (script must stay executable) and only comment-append validation. Project `.gojo/instructions.md` is per-repo shared guidance via the manifest — it does not replace the injected progress contract.

## Per-agent environment

Optional agent manifest `environment` loads allowlisted variables from a dotenv file in the **registered primary checkout** (`project.repoPath`), not the run worktree (gitignored `.env` files are absent there):

```yaml
environment:
  file: .env
  include:
    - KARAKEEP_API_URL
    - KARAKEEP_API_KEY
  required:
    - KARAKEEP_API_KEY
```

- `include` is the only set loaded from the file; unlisted keys are never injected.
- `required` must be a subset of `include`; missing/empty required keys fail during `Preparing` (messages name the key/file, never the value).
- Merge order: daemon `process.env` → selected project values → Gojo-owned `GOJO_*` (project files cannot override `GOJO_*`).
- Forge write credentials (`GH_TOKEN`, `GITHUB_TOKEN`, `FORGEJO_TOKEN`,
  `GITEA_TOKEN`, `GOJO_FORGEJO_TOKEN`, `GITLAB_TOKEN`, and configured source
  secret names) are removed from adapter and validation environments.
- Selected values are injected into the **adapter** and **validation** phases. Short-lived `GOJO_API_TOKEN` remains adapter-only.
- Durable state (`environment_json` on agents / `run_context`) stores file path + names only — never resolved values. Loaded values are redacted from streamed agent output, validation tails, and failure artifacts.

## Self-healing plumbing

- Injects `GOJO_API_URL`, `GOJO_API_TOKEN`, `GOJO_RUN_ID`, `GOJO_AGENT_ID`, and `GOJO_PROJECT_ID` into the adapter env. `agent-run-*` tokens are short-lived, restricted to `POST /runs/:id/progress` for that run, and revoked when the attempt finishes. Progress `title` is the operator **current focus** line (not the durable work identity); the platform keeps run work `title` as the agent name. Healers diagnose failed runs via `gojo run list|inspect|artifacts` (or `$GOJO_HOME/artifacts/<runId>/`) — not via the run-scoped API token.
- Enqueue atomically creates a Work item and immutable `run_context` snapshot (agent/prompt/manifest hash/profile/policies/base/schedule). State transitions, progress, validation, artifacts, and heal lineage remain attributable after restart or later manifest edits.
- On `repository.syncBeforeRun`: fetch + best-effort local ff + `syncProjectFromManifest` before prep. Worktrees branch from `origin/<base>` so a dirty primary checkout does not block runs. Local `merge --ff-only` is advisory only. Manifest sync upserts agents/schedules by name and **soft-disables** agents and schedules absent from `gojo.yaml` (rows are kept for history; they are not hard-deleted).
- Workspace branch/worktree names are `gojo/<agent>/<project>/<date>/run-<fullRunId>` (optional `-aN` attempt suffix) under `$GOJO_HOME/worktrees`. Full ULID + project slug avoids collisions when many schedules fire in the same millisecond; agent stays second so allowlists like `gojo/maintain-quality` still match. Orphan paths under the worktrees root are reclaimed before `git worktree add`.
- On failure: write `failure.json` (phase may be `workspace` when prep/sync threw while `Preparing`); if agent policy has `selfHeal`, enqueue healer when guards pass (not for heal runs / healer agent itself; not when the run never started or hit an invalid state transition; capped at 3 heal runs per project per hour). Healers must not mutate the operator checkout.
- User-facing guide: [`site/src/pages/self-healing.md`](../../site/src/pages/self-healing.md).

## Integration

`pull-request` mode pushes the run branch, then opens a PR with `integration.prTool` from the agent manifest (`gh` → `gh pr create`, `tea` → `tea pulls create`; default `gh`). Optional `prLogin` / `prRemote` are passed through for tea. Title/body come from handoff via `buildPrDescription`. The PR URL is stored on the attempt (`pr_url`) and handoff (`prUrl`). If the CLI is missing or create fails, the run **fails** (integration phase) with a `local://pr/<branch>` placeholder recorded for recovery — it does not report Succeeded.

PR integration creates a durable approval. The reconciler polls source checks
without keeping an agent process alive. When `integration.prAutoMerge` is true,
gojo schedules native forge merge-when-checks-succeed after PR create, stamps
approval autonomy `auto`, and skips the checks-settled reviewer. Otherwise,
once checks settle, a configured `pull-request-checks-settled` reviewer runs
against the PR branch. Red checks or
`changes-requested` can resume the implementing agent on that exact branch up to
`integration.fixRounds`.

Repair rounds are **PR-native**: the fix run checks out `resumeBranch` (mode
becomes `update-pull-request` — push only, no second PR) and takes as subject
the original issue when the implementing run had one, otherwise the approval’s
pull-request work item (schedule-driven maintain agents). After a fix round
reassigns `approval.runId`, the reconciler still finds the approval by PR URL /
subject so subsequent green checks enqueue review and further red checks can
consume remaining `fixRounds`. Cap / missing branch / missing subject escalate
with distinct reasons (`src/contexts/delivery/fix-rounds.ts`). Check failure feedback is
formatted as name + details + URL for the agent (`formatChecksSummary`).

The platform alone revalidates live checks and invokes the source adapter merge
operation. `integration.approval` selects manual, reviewer, or auto authority;
`autonomyLabels.auto` opts a linked issue into auto authority. Direct forge
auto-merge configuration is not part of PR creation; all merges use this control
path.

`await-approval` mode commits on the run branch (like `commit-only`), transitions
the run to `AwaitingApproval`, and returns without opening a PR. Operators
approve or reject via `gojo run approve|reject` or the Runs UI. On approval,
`integrateAndFinish` resumes with `postApprovalMode` from the manifest (default
`auto-merge`; also `commit-only` or `pull-request`). This is separate from
`pull-request` with `approval: manual`, which opens a PR first and uses the
durable approval control plane.

## Impact accounting

After integration the coordinator persists two canonical record sets (accounting failures never fail the run):

- **`run_integrations`** (one compatibility row per run) — mode, provider, PR number/URL, commit SHA, and integration status. The reconciler never abandons a nonterminal PR: current opens are checked every minute and errors back off to at most fifteen minutes. The linked Work resource carries source observation/freshness and provider sync discovers human/bot work as well as gojo-created work.
- **`run_impact_items`** (unique per `(run, category, subject)`) — built by `impact.ts` from the normalized handoff. Platform-detected changes (dependency manifests, docs, test files) are `verified`; agent `impact.items` claims whose `evidence.files` intersect the observed diff are `corroborated`; the rest stay `claimed`. One item per concrete subject; aggregate totals are rejected by the schema. Verification stays an item-level concern (shown on run detail).

The agent handoff is runtime-validated (`normalizeAgentHandoff` / `recoverAgentHandoffReport`, schema v1/v2/v3) before PR description generation and persistence; invalid handoffs fall back to the platform baseline with `handoff-validation:` warnings recorded in `unresolvedIssues`. Invalid optional `impact` / `assets` / `prUrl` are dropped so review `subjectActions.verdict` still applies. Schema v3 adds bounded `subjectActions` (labels, comment, reviewer verdict); the platform validates and executes them. Aggregates are served by `storage/impact-analytics.ts` via `GET /api/v1/dashboard/impact`. Dashboard `categoryTotals` count **distinct runs** per category (excluding `rejected`), not rows — so a single dependency bump that wrote `package.json`, a lockfile, and a package claim still counts as one. Category totals intentionally overlap when one run produced impact in more than one category.

Dashboard tiles drill into list endpoints (gateway, not dead ends):

- `GET /api/v1/integrations?status=open|merged|committed` — optional `projectId`, `from`/`to` on run `created_at`. `committed` means `commit_sha IS NOT NULL` (no PR required).
- `GET /api/v1/impact/items` — paged `run_impact_items` (excludes `rejected`) with optional `category`, `projectId`, `from`/`to`.
- `GET /api/v1/runs` — optional `from`/`to` on `created_at` (plus existing `state` / `projectId` filters) for Succeeded-runs drill-down.

## May call

- `workspace/`, `git/`
- `agents/` (adapters)
- `validation/`
- `integration/`
- `storage/`
- `app/project-sync` (manifest re-sync before run)
- `notifications/` hooks (outcomes)
- `process/` (indirectly via agents/validation)

## Must not

- Own cron / schedule tick logic (`scheduler/` does that)
- Bypass validation when policy requires it
- Let adapters write the project default branch directly
- Centrally rewrite another project’s prompts outside that project’s git tree

## PRD

- [§10 Run Lifecycle](../../PRD.md#10-run-lifecycle)
- [§13 Definition of Success](../../PRD.md#13-definition-of-success)
- [§14 Agent Handoff Contract](../../PRD.md#14-agent-handoff-contract)
- [§3.1 Agent is not authority on success](../../PRD.md#31-the-agent-is-not-the-authority-on-success)
