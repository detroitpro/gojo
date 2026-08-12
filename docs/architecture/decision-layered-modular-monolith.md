# Decision: layered modular monolith by bounded context

Living architecture decision (not an ADR log). Update this page when the decision
changes; do not add numbered `docs/adr/` files.

## Status

Accepted — implemented on `src/` and mirrored on `web/src/`.

## Context

gojo grew as a single-process Bun daemon with CLI, HTTP/WS API, scheduler, run
coordinator, and React admin UI. Early packaging was by **technical layer**
(`runs/`, `storage/`, `api/`, flat `web/src/{api,types,views}`). That shape blocked
parallel work:

- God files (`router.ts`, persistence facades, god `api.ts` / `types.ts` on web)
  forced every feature to touch the same hot spots.
- Cross-cutting imports had no enforced ownership; “just import the repo” became
  the default.
- Live UI refresh was wired per view (`useLiveRefresh`), which later multiplied
  into overlapping invalidate storms after a Zustand bridge was introduced.
- Shared wire types lived under `src/shared/` and drifted from the admin client.

Product constraints from [`PRD.md`](../../PRD.md) still apply: one process, native
binary distribution, scheduler ≠ adapter runner, adapters ≠ success authority.

## Decision

Adopt a **layered modular monolith packaged by bounded context**:

1. **Daemon `src/`** has exactly five top-level directories:
   `kernel/` · `contexts/` · `platform/` · `transports/` · `infrastructure/`.
2. **Eight bounded contexts** own product capability:
   `access`, `catalog`, `scheduling`, `execution`, `delivery`, `work`,
   `notifications`, `operations`.
3. Each context is **hexagonal internally**: `domain/` → `application/` → `ports/`
   ← `infrastructure/`, with a public `contract.ts` and registry `use-cases.ts`.
4. **Wire contracts** live in `packages/contracts` (`@gojo/contracts`), shared by
   daemon and web.
5. **Admin UI `web/src/`** mirrors the same layering and the same eight contexts
   (`api` / `types` / Zustand `store` / `views`).
6. **Live updates**: one `LiveStoreBridge` maps each `PlatformEventTopic` to a
   non-overlapping set of store `invalidate()` calls; views hydrate via
   `bindStoreRefresh` (register + load on mount). Events invalidate; RPC/HTTP reads
   hydrate — push payloads are never a second entity store.
7. **Enforcement**: `scripts/check-src-layout.sh`, `scripts/check-web-layout.sh`,
   and `.dependency-cruiser.cjs` in `make check`.

## Why this shape (not microservices, not “keep the flat tree”)

| Alternative | Rejected because |
|-------------|------------------|
| Split into multiple deployable services | Product is intentionally one process / one binary; ops and scheduling assume shared SQLite and in-process coordination. |
| Keep technical-layer packages only | Did not give ownership boundaries; god files and cross-imports continued. |
| Hexagonal everywhere without contexts | Ports/adapters without product packaging still leaves a flat grab-bag of modules. |
| UI-only restructuring | Would leave daemon god files as the bottleneck; contracts would still drift. |
| Per-view live refresh forever | Overlapping topic subscriptions invalidate the same stores many times; proven slow under real platform-event load. |
| Long-lived backwards-compat shims | Dual paths and deprecated aliases freeze the wrong shape; gojo prefers clean breaks and one-shot migrations that delete the old path. |

### Non-negotiables that drove the migration

These are recorded in [`AGENTS.md`](../../AGENTS.md) and apply to future work:

1. **Never design for backwards compatibility** — migrate and delete; do not keep
   dual APIs or forever shims.
2. **Time is never a blocker** — do not cut boundaries, tests, or docs to “ship
   sooner,” and do not defer cross-cutting platform work.
3. **Complexity is never a reason to skip the right shape** — prefer consistency,
   reusable contracts, and scale-ready APIs (e.g. server-side paging) over
   shortcuts that will not hold.

## Consequences

### Positive

- Clear “where does a new file go?” answers (`src/README.md`, `web/src/README.md`).
- Parallel work by context with small public contracts.
- Shared Zod/types between daemon and UI.
- Layout and dependency rules fail CI instead of relying on review alone.
- Live UI refresh is centralized and topic-routed without N× overlapping
  subscriptions.

### Trade-offs

- More directories and `contract.ts` ceremony for small changes.
- Composition root (`platform/`) must stay disciplined as the only place that
  wires infrastructure into contexts.
- Strangler leftovers must be tracked and deleted (`removal-backlog.md`,
  `@removal` tags) — not left as permanent compat.

### Follow-through required of agents and developers

- Read architecture docs before large changes; update living docs when ownership
  moves (`gojo-docs-hygiene`).
- Cross-context imports only through `contract.ts`.
- No per-view `useLiveRefresh` in context views.
- Finish with `make check`.

## Related

- [`overview.md`](./overview.md) — live layout
- [`boundaries.md`](./boundaries.md) — hard rules
- [`context-template.md`](./context-template.md) — new context scaffold
- [`removal-backlog.md`](./removal-backlog.md) — superseded code to delete
- [`PRD.md`](../../PRD.md) §23 — product reference architecture
