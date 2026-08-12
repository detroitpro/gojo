# Removal backlog

Code that is **superseded** by the modular-monolith migration but still present
for strangler compatibility. Delete each row when the “Remove when” condition is
met. Prefer `@removal(when: …)` comments at the call sites so `rg '@removal'`
finds the same inventory.

## Active

| ID | Path / symbol | Superseded by | Remove when |
|----|---------------|---------------|-------------|
| R3 | [`src/transports/http/openapi.ts`](../../src/transports/http/openapi.ts) `legacyOpenApiPaths` for routes still summary-only | Full Zod schemas on every registered use case | OpenAPI responses are schema-complete |
| R5 | Thick orchestration in [`src/transports/cli/index.ts`](../../src/transports/cli/index.ts) for commands without `cli:` bindings | `tryDispatchCliUseCase` + CLI bindings on use cases | Each CLI command has a registry `cli:` binding and contract coverage |
| R8 | [`src/platform/app-context.ts`](../../src/platform/app-context.ts) still wires subsystems; `composeModules` exists | Thin wrapper over `composeModules` / delete god bag | Process boot uses composition root only |
| R20 | Legacy handlers still living in `src/transports/http/router.ts` (if any survived R2 migration) | Context use cases | Contract tests cover them via the registry |
| S1 | [`src/platform/create-repositories.ts`](../../src/platform/create-repositories.ts) transitional `Repositories` bag + callers of `ctx.repos` | Typed ports on AppContext / module runtimes | No `createRepositories` / `Repositories` bag; each context wired via its ports |

## Retired (deleted or absorbed in layout reorg)

| ID | What was removed | Replaced by |
|----|------------------|-------------|
| R1/R2 | Legacy business if-chain in HTTP router | Registry + context use cases |
| R4 | Static `openApiDocument` snapshot | `buildOpenApiDocument()` only |
| R6 | `src/scheduler/policies.ts` re-export shim | `@/contexts/scheduling/contract` |
| R7 | Direct `getSchedulingPolicy` in router queue/dashboard | `operations.*` use cases |
| R9–R11 | Web type mirrors / terminal-state duplicates | `@gojo/contracts/types` |
| R14 | `src/shared/` shim dir | `packages/contracts` |
| R15 | Raw `getSchedulingPolicy` in dispatcher / ops dashboard | `readSchedulingPolicy` / `SchedulingPolicyStore` via scheduling contract |
| R16 | `src/app/instance-settings.ts` re-export barrel | Direct persistence / scheduling port |
| R17 | Policy re-exports from `src/scheduler/index.ts` | `@/contexts/scheduling/contract` |
| R18 | Top-level `src/auth/` | `contexts/access/infrastructure/auth/` |
| R19 | Top-level `src/secrets/` | `contexts/access/infrastructure/secrets/` |
| E1 | Coordinator shim re-exporting `src/runs/coordinator.ts` | Physical file at `contexts/execution/infrastructure/coordinator.ts` |
| D2 | Top-level `src/{sources,work,control,integration,runs,…}` | Absorbed into owning contexts + `infrastructure/` |
| — | Empty `src/{artifacts,audit,updates}/` | Deleted |
| — | Inline HTTP/CLI handlers for scheduling, operations, execution, notifications, delivery, work, access, catalog | Matching `*.use-cases` on the registry |
| — | Fat SQLite under `infrastructure/persistence/{approval,work,dashboard,leases,outcomes,platform-events,migrate-vocab,paged-lists impl,repositories impl}` | Context-owned adapters + `platform/create-repositories` facade; shared module keeps `db` / `schema` / `sql-paging` / types |
| W1–W4 | Legacy flat `web/src/{api,types,views,components}` tree | `web/src/{kernel,contexts,infrastructure,platform,ui}/` + `scripts/check-web-layout.sh` |
| R12 | Per-view `useLiveRefresh` in `web/src/contexts/**` | `useBindStoreRefresh` + Zustand `invalidate` via `LiveStoreBridge` |
| W5 | Zustand refresh stubs / incomplete stores | Full `bindRefresh` / `invalidate` per context store |
| W6 | Monolithic Settings / ProjectDetail / RunDetail views | Context `components/` section panels + thin route shells — **ProjectDetail done**: `ProjectShellView` + Overview / History / Impact / Health / Configuration nested routes |
| S2 | `src/contexts/work/sources.ts` compatibility barrel | `@/contexts/work/contract` |
| D1 | Inline `POST /api/v1/sources/{sourceId}/events` in `router.ts` | `work.sources.ingestWebhook` HTTP binding + `http-dispatch` raw body |

## Follow-ups from this migration

| ID | Path / symbol | Note |
|----|---------------|------|
| E2 | Execution / notifications / operations use cases publish via `runtime.outbox` but the coordinator still appends legacy `run.*` platform events through `AppContext.platformEvents` | Route coordinator emissions through the outbox once topics are unified |
| R13 | CLI/API duplicate platform-event appends for project sync + agent/schedule enable/disable | Emit once inside catalog use cases |
| D3 | `IntegrationStatusReconciler` wiring + fix-round policy still composed in `app-context` | Move into `contexts/delivery/subscribers/*` and subscribe on domain events |

## How to retire a row

1. Register the use case (HTTP + CLI bindings as needed).
2. Confirm `tests/contract/` covers the surface (do not weaken those tests).
3. Delete the legacy handler / shim; move the row to **Retired** in the same PR.
4. Run `rg '@removal'` and clear matching comments.

## Tag convention

```ts
// @removal(when: all /api/v1 routes registered): delete the legacy if-chain — removal-backlog R2
```

Find tags: `rg '@removal'`
