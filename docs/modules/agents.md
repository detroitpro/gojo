# Module: agents

**Path:** `src/agents/`

## Responsibility

Detect and invoke agent **adapters** (shell, Cursor Agent, Claude Code). Normalize invocation, timeouts, and structured handoff when present.

Registry/list/detect entrypoints are used by CLI, API, and doctor.

## May call

- `process/` for subprocess supervision
- Host PATH tools (`cursor`, `claude`, `sh`) as configured
- Read worktree paths provided by the coordinator (do not create worktrees here)

## Must not

- Decide final run success/failure for the platform
- Schedule work or open merge PRs
- Own SQLite schema

## PRD

- [§9 Agent Adapter Architecture](../../PRD.md#9-agent-adapter-architecture)
- [§3.1](../../PRD.md#31-the-agent-is-not-the-authority-on-success)
