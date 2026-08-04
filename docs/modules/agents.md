# Module: adapters (agent adapters)

**Paths:** `src/infrastructure/agent-adapters/`, `src/contexts/catalog/` (registry/list/test surfacing)

> The **catalog** bounded context (`src/contexts/catalog/`) wraps
> `src/infrastructure/agent-adapters/`, `src/infrastructure/filesystem/`, project sync, and the enable/disable
> mutations. HTTP + CLI callers hit registered use cases
> (`catalog.adapters.{list,test}`, `catalog.filesystem.browse`,
> `catalog.projects.{list,get,delete,sync,enable,disable}`,
> `catalog.agents.{list,get,enable,disable}`,
> `catalog.schedules.{list,enable,disable,pause}`,
> `catalog.impact.items.list`). `syncProject` emits `project.synced` **exactly
> once** so CLI and API no longer duplicate platform events. Sync applies
> optional manifest `enabled` fields (project / agent / schedule); ops toggles
> write SQLite only until the next Sync.

## Vocabulary

- **Adapter** — the invocation surface for a coding agent implementation (shell, Cursor Agent, Claude Code). Top-level UI/CLI "Adapters" tab in the ops console; `gojo adapter detect|list|inspect|test`.
- **Profile** — an entry in a project manifest's `profiles:` map that binds an adapter to a model, timeout, and permissions. Referenced from an agent (work unit) as `profile: <name>`.
- **Agent** — the work-unit definition (was "task" pre-rebrand). Lives under `agents:` in `gojo.yaml`; prompts live under `.gojo/agents/`.

The folder stays `src/infrastructure/agent-adapters/` for now because it holds the adapter *implementations*.

## Responsibility

Detect and invoke agent **adapters**. Normalize invocation, timeouts, and structured handoff when present.

Registry/list/detect entrypoints are used by CLI (`gojo adapter …`), API (`/api/v1/adapters`), and doctor.

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
