# Bounded-context template

Copy this layout for each new context under `src/contexts/<name>/`.

```text
src/contexts/<name>/
  domain/           Pure policies and aggregates (no SQL, fetch, Date.now)
  application/      Commands + queries (orchestrate ports, emit domain events)
  ports/            Interfaces the application needs
  infrastructure/   SQLite / adapter implementations of ports
  subscribers/      Optional domain-event / platform-event handlers
  contract.ts       Public DTOs + exported use cases — ONLY cross-context import
  use-cases.ts      Registry definitions (defineCommand / defineQuery)
  index.ts          build<Name>Module(deps) composition helper
```

## Rules

1. `domain/` imports only `@/kernel` and `@shared` / `@gojo/contracts` (same-context `domain/` peers OK).
2. `application/` imports `domain/`, `ports/`, and `@/kernel` only — not its own `infrastructure/`.
3. Other contexts import `contexts/<name>/contract` — never `domain/` or `infrastructure/`.
4. Transports (`src/transports/http`, `src/transports/cli`) call registered use cases; they do not embed policy.
5. Commands return `Result<T>` and collect `DomainEvent`s on a `UnitOfWork`; an `Outbox` publishes after commit.
6. Shared technical adapters used by 2+ contexts live in `src/infrastructure/`, not inside one context.

## Adopted contexts

| Context | Notes |
|---------|-------|
| `scheduling` | Policies, cron/upcoming, scheduling-policy store + use cases |
| `access` | Auth + secrets under `infrastructure/`; `access.me` / `access.tokens.*` on the registry. Login/logout HTML stays in `transports/http` (cookies). |
| `catalog` | Projects/agents/schedules/adapters/filesystem/project-sync |
| `execution` | Coordinator, dispatcher, workspace, validation, integrate |
| `delivery` | Approvals, control intents, merge, status reconciler |
| `work` | Source adapters, ledger, sync/webhooks, triggers |
| `notifications` | Channels + dispatcher + run-lifecycle subscriber |
| `operations` | Instance, doctor, backups, dashboard, service install |

Register new use cases in `use-cases.ts` and add them to `src/platform/register.ts`. Then delete the legacy router/CLI handler and the matching row in [`removal-backlog.md`](./removal-backlog.md).

## Tests

Prefer `tests/unit/contexts/<name>/` with in-memory port fakes (`tests/kit/`). Keep `tests/contract/` green without edits. Mirror layers under `tests/unit/{kernel,contexts,platform,transports,infrastructure}/`.
