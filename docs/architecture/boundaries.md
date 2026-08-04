# Module boundaries

Allowed and forbidden edges among daemon modules. Product rules (adapter ≠ success authority, platform owns merge) are defined in [`PRD.md`](../../PRD.md) **§3** and **§23**.

## Hard rules

1. **Scheduler does not run adapters.** It creates/enqueues runs; the run coordinator owns execution.
2. **Adapters do not decide success.** Validation + integration policy decide run outcome.
3. **Adapter subprocesses do not write the target branch.** Integration owns commit/PR/merge.
4. **HTTP handlers stay thin.** Orchestration lives in `runs/`, `app/`, and domain services—not ad-hoc logic in `api/router.ts`.
5. **SQLite access goes through `storage/`.** Don't open ad-hoc DB handles from adapters or scheduler.
6. **Sources preserve native truth.** Source adapters normalize observations; they do not collapse provider-specific state into a forge-only model.
7. **Work is the visibility read model.** UI/API counts come from the same ledger and must expose observation time and freshness.
8. **Platform events invalidate; WebSocket/HTTP reads hydrate.** Event payloads identify affected read models but never become a second entity store in the browser. The admin UI prefers one authenticated WebSocket (`/api/v1/ws`) for push + RPC; adapter subprocesses, webhooks, and CLI health remain on HTTP. Pinia stores per bounded context own `bindRefresh` / `invalidate`; `LiveStoreBridge` fans out topics; views register refresh handlers with `bindStoreRefresh`.

## Web UI boundaries (`web/src/`)

```text
platform ──► contexts ──► infrastructure ──► kernel
     │            │
     └──────► ui ──┘
```

| Layer | Role |
|-------|------|
| `kernel/` | Pure helpers — no Vue, no fetch |
| `contexts/<bc>/` | API client, types, Pinia store, views, context components |
| `platform/` | Router, `LiveStoreBridge`, `bind-store-refresh`, composables |
| `infrastructure/` | `fetch`, WebSocket, `ApiError` |
| `ui/` | Shared chrome only |

Each context exports its public surface from `contract.ts` (API + store).
Cross-context imports must use `contract.ts` only.

## Dependency sketch

```text
cli ──────────────► platform (registry dispatch) + legacy handlers
api ──────────────► platform (registry dispatch) + legacy handlers
platform/runtime ─► composition.ts → context modules (build*Module)
contexts/*        ─► its own domain / application / ports / infrastructure only
scheduler ────────► storage, runs (create/trigger only)
runs/coordinator ─► workspace, git, agents, validation, integration, storage
agents ───────────► process (subprocess), not scheduler
integration ──────► git, storage (merge queue)
sources ──────────► storage, secrets, provider APIs (never scheduler lease)
runs ─────────────► work storage (immutable context + semantic events)
domain mutations ─► events (durable topic invalidation after state changes)
validation ───────► process / shell in worktree
workspace ────────► git
```

## Context boundaries

- `contexts/scheduling` — scheduling policy (get/set, dashboard/queue reads).
- `contexts/access` — users, sessions, API tokens.
- `contexts/catalog` — projects, agents, schedules, adapters, filesystem browse, impact items.
- `contexts/delivery` — approvals, control intents, integrations.
- `contexts/execution` — run state-machine (domain), coordinator port, run list/get/diff/artifacts/progress/cancel/approve/reject.
- `contexts/notifications` — channel store port, dispatcher port, `channels.get/put/test`.
- `contexts/operations` — instance config, doctor, backups, dashboard summaries, queue snapshots, health.
- `contexts/work` — durable cross-source ledger use cases.

Each context exposes its wire surface exclusively through
`contexts/<name>/use-cases.ts` (HTTP + CLI bindings on the registry).
Cross-context calls go through the module's public contract; other
contexts must never import `application/` / `infrastructure/` symbols
directly.

## Forbidden shortcuts

| Don't | Do instead |
|-------|------------|
| Scheduler calling Cursor/Claude CLIs | Create a run; let coordinator invoke adapters |
| Adapter marking run Succeeded | Return handoff; let validation/integration decide |
| Adapter subprocess `git push` to default branch as success path | `commit-only` / PR / approval modes via integration |
| UI or router embedding cron math | `scheduler/` + storage |
| Domain modules importing `api/` for manifest sync | `app/project-sync` (shared by CLI, API, coordinator) |
| UI counting raw `run_integrations.status='open'` | Work status (`verifiedOpen` vs `staleOpen`) |
| Provider conditionals spread through router/UI | A `sources/` adapter + declared capabilities |
| Per-view polling or one WebSocket/EventSource per page | Shared `GojoSocket` + topic-driven refresh |
| Applying push payloads as canonical browser state | Invalidate and reload the owning API/RPC query |
| Per-view `useLiveRefresh` in context views | `bindStoreRefresh` + context Pinia store `invalidate` via `LiveStoreBridge` |
| Duplicating route logic for WebSocket RPC | Synthesize `Request` into `handleApiRequest` |

## When you change a boundary

Update this file and the affected [`docs/modules/`](../modules/) page in the same PR (`gojo-docs-hygiene` skill).
