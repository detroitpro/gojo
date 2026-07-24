# Module: runs

**Path:** `src/runs/`

## Responsibility

Orchestrates a single run end-to-end: prepare workspace, invoke agent adapter (with retries), validate, integrate, persist events/artifacts, emit notification hooks, optionally enqueue a project healer.

Primary type: run **coordinator** (`coordinator.ts`). Related:

| File | Role |
|------|------|
| `inspect.ts` | Diff / artifacts (`handoff.json`, `validation.json`, `failure.json`) |
| `events.ts` | In-memory run event bus |
| `failure-policy.ts` | Parse `failure_policy_json` (`maxAttemptsPerRun`, backoff, embedded `selfHeal`) |
| `heal.ts` | Decide whether to enqueue a healer (`trigger=heal`) with loop guards |

## Self-healing plumbing

- Injects `GOJO_API_URL`, `GOJO_API_TOKEN`, `GOJO_RUN_ID` into agent env.
- On `repository.syncBeforeRun`: fetch/fast-forward base + `syncProjectFromManifest` before prep.
- On failure: write `failure.json`; if task policy has `selfHeal`, enqueue healer (not for heal runs / healer task itself; capped per project/hour).
- User-facing guide: [`site/src/pages/self-healing.md`](../../site/src/pages/self-healing.md).

## May call

- `workspace/`, `git/`
- `agents/` (adapters)
- `validation/`
- `integration/`
- `storage/`
- `api/project-sync` (manifest re-sync before run)
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
