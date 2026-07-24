# Module boundaries

Allowed and forbidden edges among daemon modules. Product rules (agent ≠ success authority, platform owns merge) are defined in [`PRD.md`](../../PRD.md) **§3** and **§23**.

## Hard rules

1. **Scheduler does not run agents.** It creates/enqueues runs; the run coordinator owns execution.
2. **Adapters do not decide success.** Validation + integration policy decide run outcome.
3. **Agents do not write the target branch.** Integration owns commit/PR/merge.
4. **HTTP handlers stay thin.** Orchestration lives in `runs/`, `app/`, and domain services—not ad-hoc logic in `api/router.ts`.
5. **SQLite access goes through `storage/`.** Don’t open ad-hoc DB handles from adapters or scheduler.

## Dependency sketch

```text
cli ──────────────► app / api / domain modules
api ──────────────► app, storage, auth, diagnostics, …
scheduler ────────► storage, runs (create/trigger only)
runs/coordinator ─► workspace, git, agents, validation, integration, storage
agents ───────────► process (subprocess), not scheduler
integration ──────► git, storage (merge queue)
validation ───────► process / shell in worktree
workspace ────────► git
```

## Forbidden shortcuts

| Don’t | Do instead |
|-------|------------|
| Scheduler calling Cursor/Claude CLIs | Create a run; let coordinator invoke adapters |
| Adapter marking run Succeeded | Return handoff; let validation/integration decide |
| Agent `git push` to default branch as success path | `commit-only` / PR / approval modes via integration |
| UI or router embedding cron math | `scheduler/` + storage |

## When you change a boundary

Update this file and the affected [`docs/modules/`](../modules/) page in the same PR (`gojo-docs-hygiene` skill).
