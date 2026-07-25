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

- Injects `GOJO_API_URL`, `GOJO_API_TOKEN`, `GOJO_RUN_ID` into agent env (`agent-run-*` tokens are short-lived and revoked when the agent attempt finishes; Settings hides them by default).
- On `repository.syncBeforeRun`: fetch + best-effort local ff + `syncProjectFromManifest` before prep. Worktrees branch from `origin/<base>` so a dirty primary checkout does not block runs. Local `merge --ff-only` is advisory only.
- On failure: write `failure.json` (phase may be `workspace` when prep/sync threw while `Preparing`); if task policy has `selfHeal`, enqueue healer (not for heal runs / healer task itself; capped per project/hour). Workspace failures still enqueue heal for diagnose-and-report — healers must not mutate the operator checkout.
- User-facing guide: [`site/src/pages/self-healing.md`](../../site/src/pages/self-healing.md).

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
