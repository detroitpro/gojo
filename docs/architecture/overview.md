# Architecture overview

Product-level architecture, principles, and lifecycle live in [`PRD.md`](../../PRD.md) — especially **§3** (principles), **§9–14** (adapters, runs, Git, scheduling, success, handoff), and **§23** (reference architecture).

This page tracks the **live `src/` layout** as implemented.

## Runtime shape

```text
CLI / HTTP API / scheduler (one process)
        │
        ├─ storage (SQLite)
        ├─ workspace + git (isolated worktrees)
        ├─ agents (shell / cursor / claude-code adapters)
        ├─ validation
        ├─ integration (commit / PR / merge queue)
        └─ notifications, secrets, backup, telemetry
```

Admin UI: Vue app in `web/`, served as static assets (see `src/api/web-dist.ts`).  
User docs site: Astro in `site/` (not served by the daemon).

## `src/` modules (current)

| Directory | Role |
|-----------|------|
| `cli/` | Command entry and output formatting |
| `api/` | HTTP router, server lifecycle, web static |
| `app/` | Composition / context wiring |
| `agents/` | Adapter registry and implementations |
| `scheduler/` | Cron, overlap, disable policies |
| `runs/` | Run coordinator, events, inspect |
| `workspace/` | Worktree paths and attempt prep/cleanup (prefers `origin/<base>` when syncing) |
| `git/` | Git subprocess helpers (best-effort local ff; dirty trees OK) |
| `validation/` | Validation profile execution (inherits daemon PATH) |
| `integration/` | Integration modes + merge queue |
| `storage/` | Schema, DB, repositories |
| `auth/` | Users, passwords, tokens |
| `secrets/` | Encrypted secret store |
| `notifications/` | Channels, dispatch, hooks |
| `backup/` | Backup create/verify/restore |
| `service/` | systemd / launchd unit install (embeds PATH so tools like bun resolve) |
| `diagnostics/` | Doctor checks (instance tools + project baseCheckout / validationTools) |
| `process/` | Subprocess supervision |
| `filesystem/` | Host browse helpers for UI |
| `shared/` | Manifest, handoff, IDs, run states |
| `config/` | Paths, instance config |
| `telemetry/` | Optional OTEL hooks |
| `artifacts/`, `audit/`, `updates/` | Supporting domains |

## Related

- [Boundaries](./boundaries.md)
- [PRD §23 Reference Architecture](../../PRD.md#23-reference-architecture)
