# AGENTS.md

Instructions for AI agents and developers working in this repository.

gojo is a Bun + TypeScript agent-orchestration platform: a CLI + embedded API daemon
(`src/`), a Vue admin UI (`web/`), and a static Astro docs site (`site/`). Standard
commands live in `README.md`, `Makefile` (`make help`), and `package.json` — reference
those instead of re-deriving them.

## Non-negotiables

These override local convenience, habit, and “ship faster” pressure:

1. **Never design for backwards compatibility.** Prefer a clean break, a migration, or a
   delete of the old path. Do not keep dual APIs, shim layers, deprecated aliases, or
   “compat forever” branches unless the task explicitly requires a one-shot migration
   that removes the old path in the same change.
2. **Time is never a blocker.** Do not cut correctness, boundaries, tests, or docs to
   “save time.” Do not defer cross-cutting work with “follow-up later.”
3. **Complexity is never a reason to skip the right shape.** Prefer the holistic,
   reusable, scale-ready design (shared contracts, server-side paging when lists grow,
   clear module ownership) over a simpler shortcut that will not hold. Consistency and
   self-contained modules beat one-off copies.

Align with `.cursor/rules/gojo-planning.mdc`: optimize for a **holistic platform**, not
for how fast or small the change looks.

## Architecture (read first)

gojo is a **layered modular monolith packaged by bounded context**, with hexagonal
(ports/adapters) internals per context, registry-backed use cases, shared
`@gojo/contracts`, and a mirrored layout in `web/src/`.

| Doc | Use it for |
|-----|------------|
| [`docs/architecture/overview.md`](docs/architecture/overview.md) | Live `src/` + `web/src/` layout, contexts, live-update model |
| [`docs/architecture/decision-layered-modular-monolith.md`](docs/architecture/decision-layered-modular-monolith.md) | Why this architecture (living decision) |
| [`docs/architecture/boundaries.md`](docs/architecture/boundaries.md) | Hard rules and forbidden shortcuts |
| [`docs/architecture/context-template.md`](docs/architecture/context-template.md) | How to add a context |
| [`src/README.md`](src/README.md) | Where new daemon files go |
| [`web/src/README.md`](web/src/README.md) | Where new admin UI files go |
| [`PRD.md`](PRD.md) §3, §9–14, §23 | Product principles and reference architecture |
| [`docs/README.md`](docs/README.md) | Engineering docs index |

### Daemon (`src/`) — must follow

- Exactly five top-level directories: `kernel/`, `contexts/`, `platform/`, `transports/`,
  `infrastructure/`. Dependency direction is down only.
- Product capability lives in one of eight contexts: `access`, `catalog`, `scheduling`,
  `execution`, `delivery`, `work`, `notifications`, `operations`.
- Cross-context imports go through `contexts/<name>/contract.ts` only.
- Inside a context: `domain/` → `application/` → `ports/` ← `infrastructure/`.
- Transports stay thin; orchestration belongs in use cases / domain services.
- Enforced by `scripts/check-src-layout.sh` and `.dependency-cruiser.cjs` (via `make check`).

### Admin UI (`web/src/`) — must follow

- Layers: `kernel/`, `contexts/`, `platform/`, `infrastructure/`, `ui/`.
- Per-context `api` + `types` + Pinia `store` + `views` (+ optional `components`).
- Cross-context imports via `contexts/<name>/contract.ts` only.
- Live data: platform events **invalidate**; WebSocket/HTTP reads **hydrate**. One
  `LiveStoreBridge` topic map; views use `bindStoreRefresh(store, load)` (hydrate on
  mount). Do **not** add per-view `useLiveRefresh`.
- Enforced by `scripts/check-web-layout.sh` and depcruise (via `make check`).

### Docs hygiene

When ownership, boundaries, or public CLI/API behavior change, update
`docs/architecture/*` and/or `docs/modules/*` in the same change (skill
`gojo-docs-hygiene`). Do not create ADR logs.

## Quality gate

Finish substantive work with `make check` (skill `gojo-check`). That gate is the
source of truth for typecheck, tests, coverage ratchet, web/site build, layout, and
depcruise.

Daemon changes under `src/`: follow `gojo-tdd-daemon`. Web UI: follow `gojo-web-ui`.

## Cursor Cloud specific instructions

### Runtime / environment

- Bun is the runtime (there is no npm/pnpm lockfile). It is installed at `~/.bun/bin`
  and added to `~/.bashrc`, so interactive shells find `bun` automatically. The startup
  update script (re)installs Bun if missing and runs `bun install` in the repo root,
  `web/`, and `site/`.
- Instance state lives under `~/.gojo` (`GOJO_HOME` to override): SQLite DB, worktrees,
  artifacts, secrets, and `config/instance.yaml`.

### Tests — non-obvious caveat

- `bun test` runs 100+ files concurrently and many spawn real `git` subprocesses. On the
  4-CPU cloud VM the default 5s per-test timeout is too tight, so a *different* random
  subset of the git/workspace/integration tests times out on each run (flaky, not real
  failures). Those suites are **skipped automatically** in cloud dev when `CURSOR_AGENT=1`
  (or `GOJO_CLOUD_DEV=1`); CI still runs them. Force them in cloud with
  `GOJO_RUN_CLOUD_INCOMPATIBLE_TESTS=1 bun test`.
- For a full local/cloud run without skips, use a longer timeout:
  `bun test --timeout 30000`. Web tests (`bun run --cwd web test`) are fast and reliable.
- `make check` / `scripts/ci-check.sh` is the full gate (daemon typecheck+test with
  30s timeout, coverage ratchet vs `coverage-baseline.json`, web typecheck+test+build,
  site build, binary compile). The gate sets `GOJO_RUN_CLOUD_INCOMPATIBLE_TESTS=1` so
  git-heavy suites are never skipped under `make check`. Outside the gate, those suites
  still skip when `CURSOR_AGENT=1` unless you force them.

### Running the app

- `bun run dev` (or `make dev`) runs the API daemon on `http://127.0.0.1:7430` (hot
  reload) plus the Vite admin UI on `http://127.0.0.1:5173` (HMR). Use the Vite URL when
  working on the UI — it proxies `/api` to `:7430`. `bun run dev:server` is API-only.
- Create the first admin once with `gojo setup --username <u> --password <p>`
  (via `bun run gojo setup ...` from a checkout). Then log into the web UI with those
  credentials.
- Core end-to-end flow (from `README.md`): register a target repo that contains a
  `gojo.yaml`, `gojo project sync <id>`, then `gojo agent run <agent-id>`. A shell agent
  run should reach state `Succeeded` and, in `commit-only` mode, land its changes on a
  `gojo/run/<agent>/<project>/<date>/run-<id>` branch without merging to `main`.
