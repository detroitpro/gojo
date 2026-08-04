# Maintain architecture (hexagonal modular monolith)

You keep **gojo** honest to its architecture: a layered modular monolith packaged by
bounded context, with hexagonal (ports/adapters) internals. Pedantic structure and
TypeScript; no product features.

## Goals

1. Enforce the layout and dependency rules in:
   - [`docs/architecture/decision-layered-modular-monolith.md`](docs/architecture/decision-layered-modular-monolith.md)
   - [`docs/architecture/boundaries.md`](docs/architecture/boundaries.md)
   - [`docs/architecture/overview.md`](docs/architecture/overview.md)
   - [`docs/architecture/context-template.md`](docs/architecture/context-template.md)
   - [`src/README.md`](src/README.md) / [`web/src/README.md`](web/src/README.md)
2. Delete or finish strangler leftovers from [`docs/architecture/removal-backlog.md`](docs/architecture/removal-backlog.md) (`rg '@removal'`).
3. Keep hexagonal layers clean inside each context (`domain` → `application` → `ports` ← `infrastructure`).
4. Prefer clarity and testable seams; do not invent dual paths or forever-compat shims.
5. Leave the tree ready for `make check` (or at least `bun run typecheck` + targeted tests for what you touched).

## Architecture you protect

### Daemon (`src/`)

- Exactly five top-level dirs: `kernel/`, `contexts/`, `platform/`, `transports/`,
  `infrastructure/`. Dependencies point **down only**.
- Eight contexts: `access`, `catalog`, `scheduling`, `execution`, `delivery`, `work`,
  `notifications`, `operations`.
- Cross-context imports **only** via `contexts/<name>/contract.ts`.
- Inside a context:
  - `domain/` — pure policy (no SQL, fetch, `Date.now`, Bun APIs)
  - `application/` — use cases; import `domain/`, `ports/`, `@/kernel` — **not** own `infrastructure/`
  - `ports/` — interfaces
  - `infrastructure/` — adapters implementing ports
  - `use-cases.ts` — registry bindings; transports stay thin
- Shared technical adapters used by 2+ contexts live in `src/infrastructure/`.
- Wire DTOs/schemas live in `packages/contracts` (`@gojo/contracts`).

### Admin UI (`web/src/`)

- Layers: `kernel/`, `contexts/`, `platform/`, `infrastructure/`, `ui/`.
- Per-context `api` / `types` / Pinia `store` / `views` (+ optional `components`).
- Cross-context imports via `contract.ts` only.
- Live data: events **invalidate**, RPC/HTTP **hydrate**. One `LiveStoreBridge`;
  views use `bindStoreRefresh`. Do **not** add per-view `useLiveRefresh`.

### Non-negotiables (also in `AGENTS.md`)

1. **Never design for backwards compatibility** — migrate and delete the old path in
   the same change; no forever shims, dual APIs, or deprecated aliases.
2. **Time is never a blocker** — do not leave boundary violations “for later.”
3. **Complexity is never a reason to skip the right shape** — prefer the holistic
   contract/context shape over a shortcut.

## Scope

- Primary: `src/`, `packages/contracts/`, `web/src/` when UI boundaries drift, and
  tests that must move with a rename/extract.
- Update `docs/architecture/*` / `docs/modules/*` only when ownership genuinely changed
  (same PR as the code).
- Do **not** redesign product UX or expand the public API for “niceness.”
- Coverage hunting belongs to `maintain-tests`; docs-only drift belongs to `maintain-docs`.

## What to hunt (priority order)

1. **Boundary violations** — context importing another context’s `application/`,
   `domain/`, or `infrastructure/`; sixth top-level under `src/` or `web/src/`;
   transports embedding policy that belongs in a use case.
2. **Hexagonal leaks** — `domain/` touching I/O; `application/` importing concrete
   SQLite/adapters; ports missing where a use case should depend on an interface.
3. **Strangler debt** — active rows in `removal-backlog.md` and `@removal` call sites
   that are safe to delete now.
4. **Fat composition / god bags** — thickenings in `platform/app-context.ts`,
   `create-repositories.ts`, or `transports/http/router.ts` / CLI that should be
   registry use cases + context ports.
5. **Web layout drift** — god `api`/`types`, cross-context deep imports, per-view
   live refresh, stores without `bindRefresh`/`invalidate`.
6. **Clarity** — only after architecture is honest: extract small functions, tighten
   types, remove dead dual paths. Do not add abstraction for its own sake.

## Hard rules

- Branch will look like `gojo/maintain-quality/...`.
- **Limit:** one theme per run; touch at most **8** production/source files (tests that
  must move with a rename do not count against this).
- If the theme needs more than the limit, stop with a clean partial win if checks for
  the touched area pass, and put the rest in `recommendedNextActions`.
- Behavior-preserving unless the task is explicitly deleting a superseded path (then
  delete completely — no compat leftover).

## Process

1. Read `docs/architecture/boundaries.md`, `context-template.md`, and skim
   `removal-backlog.md` + `rg '@removal'`.
2. Pick **one** theme (example: “catalog contract-only imports”, “delete S2 sources
   barrel”, “thin one CLI command onto registry”).
3. Refactor toward the template; update living docs if ownership moved.
4. Verify: `bun run typecheck` and the narrowest tests for what you touched; prefer
   `make check` when layout/depcruise might be affected.
5. If nothing architectural needs cleanup, leave a clean tree and say so in the handoff.

## Required handoff

Write `.gojo/handoff.json` (see project instructions for report judgment). Include
`summary` (what boundary/hexagonal win / why / value — or “no changes”), `filesChanged`,
`decisions` with rationale, `unresolvedIssues` / `recommendedNextActions` (next backlog
rows or `@removal` sites), `agentAssessment`, `status`: `"completed"`. Prefer
`impact` category `maintenance` when claiming structural outcomes.
