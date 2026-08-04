# `src/` — layered modular monolith

`src/` has exactly five top-level directories. Dependency direction is **down only**.

```text
src/
  kernel/           zero-dependency primitives (Clock, Result, DomainEvent, Outbox)
  contexts/         the 8 bounded contexts — what the product does
  platform/         app host: registry, dispatch, composition, config, events, telemetry
  transports/       edges: http/ (+ws), cli/
  infrastructure/   shared technical adapters: persistence, process, git, filesystem, agent-adapters
```

```text
transports ──► platform ──► contexts ──► kernel
                   │            │
                   └─────► infrastructure ──► kernel
```

Enforced by:

- `scripts/check-src-layout.sh` — no sixth top-level directory
- `.dependency-cruiser.cjs` — layer + context boundary rules (wired into `make check`)

## Where does a new file go?

| If the change is… | Put it in… |
|-------------------|------------|
| A pure domain rule for one product capability | `contexts/<name>/domain/` |
| A use case (command/query) for one capability | `contexts/<name>/application/` |
| An interface the use case needs | `contexts/<name>/ports/` |
| SQLite / adapter implementing that port | `contexts/<name>/infrastructure/` |
| Something another context must call | export it from `contexts/<name>/contract.ts` only |
| Shared across 2+ contexts with no business rules (git, process, SQLite schema) | `infrastructure/` |
| Registry, composition root, instance.yaml, platform event feed | `platform/` |
| HTTP/WS/CLI transport only | `transports/` |
| Clock / Result / DomainEvent / Outbox primitives | `kernel/` |

## Bounded contexts

| Context | Owns |
|---------|------|
| `access` | Users, sessions, API tokens, secrets store |
| `catalog` | Projects, agents, schedules, adapters, filesystem browse, project sync |
| `scheduling` | Overlap/missed-run policies, cron tick, upcoming, scheduling policy store |
| `execution` | Run coordinator, dispatcher, workspace, validation, PR integrate |
| `delivery` | Approvals, control intents, merge service, PR status reconciler |
| `work` | Source adapters, work ledger, sync/webhook, triggers |
| `notifications` | Channel store, dispatcher, run-lifecycle hooks |
| `operations` | Instance config, doctor, backups, dashboard, service install |

Cross-context imports **must** go through `contexts/<name>/contract.ts`.

## Related docs

- [Architecture overview](../docs/architecture/overview.md)
- [Context template](../docs/architecture/context-template.md)
- [Removal backlog](../docs/architecture/removal-backlog.md)
- [Boundaries](../docs/architecture/boundaries.md)

## Packages vs `src/` layers

- **`packages/contracts`** — shared wire DTOs/schemas (daemon + web). Grow this when both sides need a pure type.
- **Do not** extract `kernel/`, `git/`, `process/`, or persistence into new packages for a single Bun binary; layers + dependency-cruiser already enforce boundaries.
- **`infrastructure/persistence/`** keeps `db` / `schema` / thin helpers and the transitional `createRepositories` / `paged-lists` facades. Context-owned SQL lives under `contexts/*/infrastructure/` (S1).
