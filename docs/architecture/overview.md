# Architecture overview

Product-level architecture, principles, and lifecycle live in [`PRD.md`](../../PRD.md) — especially **§3** (principles), **§9–14** (adapters, runs, Git, scheduling, success, handoff), and **§23** (reference architecture).

This page tracks the **live `src/` layout** as implemented.

## Runtime shape

```text
CLI / HTTP API / scheduler tick (one process)
        │
        ├─ storage (SQLite)
        ├─ runs: enqueue → dispatcher admits → coordinator executes
        ├─ workspace + git (isolated worktrees)
        ├─ agents (shell / cursor / claude-code adapters)
        ├─ validation
        ├─ integration (commit / PR / merge queue)
        ├─ sources (GitHub / GitLab / Forgejo / generic work sync)
        ├─ work (durable cross-source ledger, links, events, freshness)
        └─ notifications, secrets, backup, telemetry
```

Admin UI: Vue app in `web/`, served as static assets (see `src/api/web-dist.ts`).  
User docs site: Astro in `site/` (not served by the daemon).

Visual identity (admin + docs) is token-driven from [`theme/`](../../theme/) — shared CSS variables in `theme/tokens.css` (Six Eyes cyan / midnight navy, DM Sans + JetBrains Mono). Brand wordmarks use mono; titles use sans with normal tracking. The admin “ops console” look is CSS composition on those tokens, not a separate component library.

## `src/` modules (current)

| Directory | Role |
|-----------|------|
| `cli/` | Command entry and output formatting |
| `api/` | HTTP router, server lifecycle, web static |
| `app/` | Composition / context wiring, `project-sync` |
| `agents/` | Adapter registry and implementations |
| `scheduler/` | Cron, overlap/missed-run, auto-disable; enqueue only (dispatcher admits) |
| `runs/` | Coordinator, dispatcher/admission, heal, impact, prompt assembly, inspect |
| `workspace/` | Worktree paths and attempt prep/cleanup (prefers `origin/<base>` when syncing) |
| `git/` | Git subprocess helpers (best-effort local ff; dirty trees OK) |
| `validation/` | Validation profile execution (inherits daemon PATH) |
| `integration/` | Integration modes, merge queue, external PR status reconciler |
| `sources/` | Source adapter registry, repository discovery, polling/webhook ingestion |
| `storage/` | Schema, DB, repositories |
| `auth/` | Users, passwords, tokens |
| `secrets/` | Encrypted secret store |
| `notifications/` | Channels, dispatch, hooks (Slack/webhooks + Telegram Bot API) |
| `backup/` | Backup create/verify/restore |
| `service/` | systemd / launchd unit install (embeds PATH so tools like bun resolve) |
| `diagnostics/` | Doctor checks (instance tools + project baseCheckout / validationTools) |
| `process/` | Subprocess supervision |
| `filesystem/` | Host browse helpers for UI |
| `shared/` | Manifest, handoff, IDs, run states, source-agnostic Work contract |
| `config/` | Paths, instance config |
| `telemetry/` | Optional OTEL hooks |
| `artifacts/`, `audit/`, `updates/` | Supporting domains |

## Related

- [Boundaries](./boundaries.md)
- [PRD §23 Reference Architecture](../../PRD.md#23-reference-architecture)
