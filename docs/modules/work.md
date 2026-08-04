# Module: work

**Paths:** `packages/contracts/src/work.ts`, `src/infrastructure/persistence/work-repositories.ts`

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
time, next sync, and freshness. For gojo runs, `title` is the durable agent name
(work-unit); adapter progress updates `summary` (and focus fields in
`nativeJson`) without renaming the work item. List responses enrich each row
with `agentName` (run agent or delivering agent via a `delivers` link),
`profileLabel` (actor / profile / adapter / provenance), and `deliveredWork`
(outbound `delivers` targets on run rows so History can nest a PR under its
run). Source sync may upgrade provenance to `gojo-agent` (for example `gojo/`
PR branches) but never downgrades an existing `gojo-agent` row when a forge
author looks human. Verified-open counts include only current observations. A
last-known-open stale item is shown under attention and never counted as
verified open. Operator-resolved items leave Needs attention, stay visible in
History, and are excluded from `needsAttention` / `staleOpen` until a later
source observation reports them active again.

`work_links` records causality such as run → delivered PR and healer → failed
run. `work_events` is append-only and supplies durable lifecycle replay after a
daemon restart (`work.stale`, `work.verified_terminal`, `work.resolved`,
`work.state_changed`, and source observations). Raw agent output remains
transient/artifact data rather than the lifecycle source of truth.

Issue-driven runs snapshot their untrusted issue or pull-request subject in
`run_context.subject_json` and link the run to that Work item. Label triggers
claim eligible issues with a bounded per-agent cap. The implementing agent opens
a PR; durable `approvals` then track settled checks, an independent reviewer
verdict, autonomy policy, repair-round count, and the platform merge result.
`control_intents` deduplicate operator decisions arriving from API, CLI, UI, or
trusted forge comments. Agents may request comments, labels, and a review
verdict in handoff schema v3, but cannot merge.

### State history and trends

`work.state_changed` is the state of record for status axes. Every
`work_items` mutation that changes `execution`, `delivery`, `outcome`,
`attention`, `sync_state`, `resolution`, or `archived_at` appends one row with
those columns populated (narrative events leave them NULL). Kind is stored in
`data_json` so per-kind replay survives hard deletes of the work item row.

`countWorkStateAt({ projectId?, kind?, at })` replays the latest state row per
item at or before `at`. `work_status_rollup` is a rebuildable hourly
memoization of that query keyed by `(project_id, kind, bucket_at)` — not a
second source of truth. Cold reads materialize on miss; the just-closed hour is
also pinned when a state change lands. Rebuild with
`gojo work-status rebuild [--project <id>] [--from <iso>]`.

`GET /api/v1/projects/:id/work/status?compare=24h|7d|30d` returns live counts
plus `previous` / `previousAsOf` / `compareWindow` from the rollup.

Documented limits: items created after `at` are excluded; cascaded deletes remove
ledger rows (the rollup pins answers already materialized); a bucket with no
prior activity materializes on first read; `archived_at` is filtered but not yet
written by any code path.

## APIs and CLI

- `GET /api/v1/projects/:id/work` (paged and filtered; `history=1` for completed / verified-terminal / operator-resolved, ordered by completion)
- `GET /api/v1/projects/:id/work/status` (`compare=24h|7d|30d`, default `24h`)
- `gojo work-status rebuild [--project <id>] [--from <iso>]`
- `GET /api/v1/work/:id`
- `GET /api/v1/work/:id/diff`
- `GET|POST /api/v1/approvals` and approval decision endpoints
- `POST /api/v1/control/intents`
- `POST /api/v1/work/:id/recheck`
- `POST /api/v1/work/:id/resolve`
- `gojo project work|status <id>`
- `gojo approval list|show|approve|reject|hold|set-autonomy`
- `gojo work claim <work-item-id> --agent <agent-id>`
- `gojo project work <id> [--kind …] [--provenance gojo-agent|human|bot|external] [--delivery none|draft|open|review|blocked|merged|closed] [--attention none|approval|blocked|sync-error|stale] [--history]` (first page only; API adds paging and more filters)

Kind vocabulary is unchanged: `run` still denotes a gojo agent execution row; the durable identity name on that row is the agent (work-unit) name.
- `gojo project recheck-work <id> <workItemId>`
- `gojo project resolve-work <id> <workItemId> [--by <actor>] [--note <text>]`

The project command center consumes these contracts for Now, Needs attention,
Delivery, and History. Needs attention rows expose reason-specific actions
(review run, retry source, recheck item, mark resolved). The Vue UI renders
work kind, result, execution, delivery, attention, and sync enums as shared
icon badges (`web/src/components/status/*`) with accessible labels. Specialist
run/integration views remain compatibility surfaces.

## Boundaries

- Work owns normalization, provenance, links, and observations.
- A source adapter owns translation from source-native payloads.
- Runs own execution and append semantic events before publishing live events.
- The UI must not recompute a competing open-work count.
