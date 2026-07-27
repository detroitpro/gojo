# Module: work

**Paths:** `src/shared/work.ts`, `src/storage/work-repositories.ts`

## Responsibility

The Work ledger is the operator-facing record of what is happening or happened
on a project. It combines gojo runs with work observed in connected systems
without pretending that gojo owns those systems' native state.

`WorkItem` has independent axes:

- `execution`: queue and run phase
- `delivery`: draft/open/review/blocked/merged/closed
- `outcome`: pending/succeeded/failed/no-change/canceled
- `attention`: approval/blocked/sync-error/stale

An item also records provenance, source identity, native state/JSON, observation
time, next sync, and freshness. Verified-open counts include only current
observations. A last-known-open stale item is shown under attention and never
counted as verified open.

`work_links` records causality such as run → delivered PR and healer → failed
run. `work_events` is append-only and supplies durable lifecycle replay after a
daemon restart. Raw agent output remains transient/artifact data rather than
the lifecycle source of truth.

## APIs and CLI

- `GET /api/v1/projects/:id/work` (paged and filtered)
- `GET /api/v1/projects/:id/work/status`
- `GET /api/v1/work/:id`
- `gojo project work|status <id>`

The project command center consumes these contracts for Now, Needs attention,
Delivery, and History. Specialist run/integration views remain compatibility
surfaces.

## Boundaries

- Work owns normalization, provenance, links, and observations.
- A source adapter owns translation from source-native payloads.
- Runs own execution and append semantic events before publishing live events.
- The UI must not recompute a competing open-work count.
