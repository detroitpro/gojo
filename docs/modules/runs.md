# Module: runs

**Path:** `src/runs/`

## Responsibility

Orchestrates a single run attempt end-to-end: prepare workspace, invoke agent adapter, validate, integrate, persist events/artifacts, emit notification hooks.

Primary type: run **coordinator** (`coordinator.ts`). Inspect helpers live in `inspect.ts`; event helpers in `events.ts`.

## May call

- `workspace/`, `git/`
- `agents/` (adapters)
- `validation/`
- `integration/`
- `storage/`
- `notifications/` hooks (outcomes)
- `process/` (indirectly via agents/validation)

## Must not

- Own cron / schedule tick logic (`scheduler/` does that)
- Bypass validation when policy requires it
- Let adapters write the project default branch directly

## PRD

- [§10 Run Lifecycle](../../PRD.md#10-run-lifecycle)
- [§13 Definition of Success](../../PRD.md#13-definition-of-success)
- [§14 Agent Handoff Contract](../../PRD.md#14-agent-handoff-contract)
- [§3.1 Agent is not authority on success](../../PRD.md#31-the-agent-is-not-the-authority-on-success)
