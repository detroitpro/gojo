# Module: runs

**Path:** `src/runs/`

## Responsibility

Orchestrates a single run end-to-end: prepare workspace, invoke agent adapter (with retries), validate, integrate, persist events/artifacts, emit notification hooks, optionally enqueue a project healer.

Primary type: run **coordinator** (`coordinator.ts`). Related:

| File | Role |
|------|------|
| `prompt-assembly.ts` | Build adapter prompt: optional `instructions` + task prompt + validation gate |
| `inspect.ts` | Diff / artifacts (`handoff.json`, `validation.json`, `failure.json`) |
| `events.ts` | In-memory run event bus |
| `failure-policy.ts` | Parse `failure_policy_json` (`maxAttemptsPerRun`, backoff, embedded `selfHeal`) |
| `heal.ts` | Decide whether to enqueue a healer (`trigger=heal`) with loop guards |

## Prompt assembly

For non-shell adapters, `assembleAgentPrompt` prepends manifest `instructions.scheduledRunNotice` and each `instructions.files` path (read from the **worktree**, fail-fast if missing or path-escapes), then the task `promptFile` body, then the validation command section. Shell adapters skip instructions (script must stay executable) and only comment-append validation.

## Self-healing plumbing

- Injects `GOJO_API_URL`, `GOJO_API_TOKEN`, `GOJO_RUN_ID`, `GOJO_TASK_ID`, and `GOJO_PROJECT_ID` into agent env (`agent-run-*` tokens are short-lived and revoked when the agent attempt finishes; Settings hides them by default).
- On `repository.syncBeforeRun`: fetch + best-effort local ff + `syncProjectFromManifest` before prep. Worktrees branch from `origin/<base>` so a dirty primary checkout does not block runs. Local `merge --ff-only` is advisory only. Manifest sync upserts tasks/schedules by name and **soft-disables** tasks and schedules absent from `gojo.yaml` (rows are kept for history; they are not hard-deleted).
- On failure: write `failure.json` (phase may be `workspace` when prep/sync threw while `Preparing`); if task policy has `selfHeal`, enqueue healer when guards pass (not for heal runs / healer task itself; not when the run never started or hit an invalid state transition; capped at 3 heal runs per project per hour). Healers must not mutate the operator checkout.
- User-facing guide: [`site/src/pages/self-healing.md`](../../site/src/pages/self-healing.md).

## Integration

`pull-request` mode pushes the run branch, then opens a PR with `integration.prTool` from the task manifest (`gh` → `gh pr create`, `tea` → `tea pulls create`; default `gh`). Optional `prLogin` / `prRemote` are passed through for tea. Title/body come from handoff via `buildPrDescription`. The PR URL is stored on the attempt (`pr_url`) and handoff (`prUrl`). If the CLI is missing or create fails, the run **fails** (integration phase) with a `local://pr/<branch>` placeholder recorded for recovery — it does not report Succeeded.

When `prTool: tea` and `prAutoMerge: true`, gojo POSTs Forgejo’s pulls merge API with `merge_when_checks_succeed: true` (requires `prApiUrl`, `prRepo`, and daemon env `GOJO_FORGEJO_TOKEN` or `FORGEJO_TOKEN`). Auto-merge failures do **not** fail the run; they are recorded on the handoff as `unresolvedIssues` (`prAutoMerge: …`).

## Impact accounting

After integration the coordinator persists two canonical record sets (accounting failures never fail the run):

- **`run_integrations`** (one row per run) — mode, provider (`forgejo` for tea, `github` for gh), PR number/URL, commit SHA, and a status independent of run state: `open` / `merged` / `closed` / `committed` / `conflict` / `failed`. Direct `auto-merge` persists `merged` immediately; `pull-request` persists `open` with a `next_check_at` so the integration-status reconciler (`integration/status-reconciler.ts`, invoked from the scheduler tick) can observe the external merge/close later. “Automation merged” metrics count `merged` integration rows — never `RunState.Succeeded`.
- **`run_impact_items`** (unique per `(run, category, subject)`) — built by `impact.ts` from the normalized handoff. Platform-detected changes (dependency manifests, docs, test files) are `verified`; agent `impact.items` claims whose `evidence.files` intersect the observed diff are `corroborated`; the rest stay `claimed`. One item per concrete subject; aggregate totals are rejected by the schema.

The agent handoff is runtime-validated (`normalizeAgentHandoff`, schema v1/v2) before PR description generation and persistence; invalid handoffs fall back to the platform baseline with `handoff-validation:` warnings recorded in `unresolvedIssues`. Aggregates are served by `storage/impact-analytics.ts` via `GET /api/v1/dashboard/impact`.

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
