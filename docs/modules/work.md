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
- `resolution`: operator-cleared attention (`operator`) without inventing a
  terminal delivery

An item also records provenance, source identity, native state/JSON, observation
time, next sync, and freshness. Source sync may upgrade provenance to
`gojo-agent` (for example `gojo/` PR branches) but never downgrades an existing
`gojo-agent` row when a forge author looks human. Verified-open counts include
only current observations. A last-known-open stale item is shown under attention
and never counted as verified open. Operator-resolved items leave Needs
attention, stay visible in History, and are excluded from `needsAttention` /
`staleOpen` until a later source observation reports them active again.

`work_links` records causality such as run → delivered PR and healer → failed
run. `work_events` is append-only and supplies durable lifecycle replay after a
daemon restart (`work.stale`, `work.verified_terminal`, `work.resolved`, and
source observations). Raw agent output remains transient/artifact data rather
than the lifecycle source of truth.

## APIs and CLI

- `GET /api/v1/projects/:id/work` (paged and filtered)
- `GET /api/v1/projects/:id/work/status`
- `GET /api/v1/work/:id`
- `POST /api/v1/work/:id/recheck`
- `POST /api/v1/work/:id/resolve`
- `gojo project work|status <id>`
- `gojo project work <id> [--kind …] [--provenance gojo-agent|human|bot|external] [--delivery none|draft|open|review|blocked|merged|closed] [--attention none|approval|blocked|sync-error|stale]` (first page only; API adds paging and more filters)
- `gojo project recheck-work <id> <workItemId>`
- `gojo project resolve-work <id> <workItemId> [--by <actor>] [--note <text>]`

The project command center consumes these contracts for Now, Needs attention,
Delivery, and History. Needs attention rows expose reason-specific actions
(review run, retry source, recheck item, mark resolved). Specialist
run/integration views remain compatibility surfaces.

## Boundaries

- Work owns normalization, provenance, links, and observations.
- A source adapter owns translation from source-native payloads.
- Runs own execution and append semantic events before publishing live events.
- The UI must not recompute a competing open-work count.
