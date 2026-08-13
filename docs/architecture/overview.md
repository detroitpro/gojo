# Architecture overview

Product-level architecture, principles, and lifecycle live in [`PRD.md`](../../PRD.md) — especially **§3** (principles), **§9–14** (adapters, runs, Git, scheduling, success, handoff), and **§23** (reference architecture).

This page tracks the **live `src/` layout** as implemented. Start with [`src/README.md`](../../src/README.md) for the on-disk layer map.

## Runtime shape

```text
CLI / HTTP API / scheduler tick (one process)
        │
        ├─ platform (composition, registry, config, events, telemetry)
        ├─ contexts/* (use cases + domain)
        │     access · catalog · scheduling · execution
        │     delivery · work · notifications · operations
        ├─ infrastructure (persistence, git, process, filesystem, agent-adapters)
        └─ transports (http + ws, cli)
```

Admin UI: React + Atlassian Design System app in `web/`, served as static assets
(see `src/transports/http/web-dist.ts`). Browser clients use one authenticated
WebSocket at `/api/v1/ws` for live events and RPC; REST remains for agents,
webhooks, and CLI health.

### `web/src/` layers

```text
web/src/
  kernel/         pure TS helpers (format, pagination, status-icons)
  contexts/       8 bounded contexts — api, types, store, views, components
  platform/       app host: router, LiveStoreBridge, useBindStoreRefresh
  infrastructure/ HTTP transport, WebSocket client, platform-events
  ui/             Atlaskit wrappers (AppButton, AppShell, StatusBadge)
```

Live updates: `LiveStoreBridge` maps each `PlatformEventTopic` (non-overlapping) to
Zustand `invalidate()` on the owning context store; views bind their `load` handlers
via `useBindStoreRefresh(store, refresh)` on mount. Cross-context imports go
through `contexts/<name>/contract.ts` (enforced by `.dependency-cruiser.cjs`).

User docs site: Astro in `site/` (not served by the daemon).

Visual identity (admin + docs) is token-driven from [`theme/`](../../theme/) — shared
CSS variables in `theme/tokens.css` mapped to Atlassian Design System light and dark
theme values (dark keyed off `html[data-color-mode="dark"]`; Atlaskit `--ds-*`
surfaces bridged onto the same ramp), plus Atlaskit components in the admin UI with
a Light / Dark / Auto toggle. Brand wordmarks use mono; body type uses the ADS
system stack. Status chrome uses a custom neutral `StatusBadge` (not Atlaskit
Lozenge) so only icons carry semantic color.

## `src/` layers (current)

| Directory | Role |
|-----------|------|
| `kernel/` | Zero-dep primitives: `Clock`, `Result`, `DomainEvent`, `UnitOfWork`, `Outbox` |
| `contexts/` | Eight bounded contexts — product capabilities (see table below) |
| `platform/` | Host: registry, HTTP/CLI dispatch, composition root, `app-context`, config, events, telemetry |
| `transports/` | `http/` (router, WS hub/RPC, server, web static) and `cli/` |
| `infrastructure/` | Shared adapters: `persistence/` (SQLite), `git/`, `process/`, `filesystem/`, `agent-adapters/`, `merge-queue.ts` |

**Shared wire contracts** live at repo-root `packages/contracts/` (`@gojo/contracts`), not under `src/`.

### Bounded contexts

| Context | Owns |
|---------|------|
| `access` | Users, sessions, API tokens, secrets |
| `catalog` | Projects, agents, schedules, adapters, filesystem browse, project sync |
| `scheduling` | Policies, cron tick/leases, upcoming, scheduling-policy store |
| `execution` | Coordinator, dispatcher/admission, workspace, validation, PR integrate |
| `delivery` | Approvals, control intents, merge service, PR status reconciler |
| `work` | Source adapters, work ledger, sync/webhooks, triggers |
| `notifications` | Channel store, dispatcher, run-lifecycle hooks |
| `operations` | Instance config, doctor, backups, dashboard, service install |

Cross-context imports go through `contexts/<name>/contract.ts` only. Layout is enforced by `scripts/check-src-layout.sh` and `.dependency-cruiser.cjs`.

## Behavior locks

Outside-in characterization suites under [`tests/contract/`](../../tests/contract/)
pin the HTTP API, CLI, and shell commit-only pipeline so structural refactors cannot
drift the product surface unnoticed. Admin view mount smoke lives in
`web/tests/views-smoke.vitest.tsx`. See `tests/contract/README.md`.

## Related

- [`src/README.md`](../../src/README.md) — where new files go
- [Decision: layered modular monolith](./decision-layered-modular-monolith.md) — why this shape
- [Context template](./context-template.md)
- [Boundaries](./boundaries.md)
- [Removal backlog](./removal-backlog.md)
- [PRD §23 Reference Architecture](../../PRD.md#23-reference-architecture)
