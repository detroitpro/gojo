# Module: platform events

**Paths:** `packages/contracts/src/events.ts`, `packages/contracts/src/ws.ts`, `src/platform/events/`, `src/transports/http/ws/`,
`web/src/infrastructure/ws-client.ts`, `web/src/infrastructure/platform-events.ts`,
`web/src/platform/useLiveQuery.ts`

## Responsibility

Platform change events invalidate operator-facing read models when durable state
changes. They do not duplicate the full entity. Each event identifies the
project, entity, mutation type, affected UI topics, occurrence time, and a
monotonic SQLite sequence.

`platform_change_events` is a durable, bounded changelog. It retains seven days
and at most 50,000 events. The sequence is the reconnect cursor; events are
replayed in order after daemon restarts.

## Delivery contract

- `GET /api/v1/ws` is the authenticated WebSocket. It carries:
  - **platform** subscriptions (topic / project filters, `after` sequence cursor)
  - **run** subscriptions (namespaced `{ durable, live }` cursors)
  - **RPC** `req`/`res` frames that synthesize HTTP requests into `handleApiRequest`
- Adapter subprocesses, signed source webhooks, CLI health, OpenAPI, and pre-auth
  (`/setup`, `/auth/login`, `/auth/logout`) stay on HTTP.
- Scoped run-progress tokens (`run:progress:{runId}`) are rejected at WebSocket upgrade.
- In-process subscribers wake the hub immediately; a single five-second database
  repair loop (shared across all sockets) catches changes written by another
  CLI process.

Topics are read-model boundaries: `dashboard`, `overview`, `impact`, `queue`,
`runs`, `agents`, `schedules`, `projects`, `work`, and `sources`.

Wire types live in `packages/contracts/src/ws.ts`. Inbound frames are validated with Zod in
`src/transports/http/ws/schema.ts`.

## Producers

Run lifecycle, dispatcher-visible state, integration reconciliation, source
sync/webhooks, project/agent/schedule mutations, and instance scheduling changes
append targeted invalidations after their durable mutation.

## Browser behavior

The React shell owns one shared `GojoSocket` (`web/src/infrastructure/ws-client.ts`). Views
subscribe by topic and optionally project through `PlatformEventHub`, coalesce
bursts, and serialize refreshes. The last valid platform sequence is kept in
session storage. Disconnects use exponential reconnect, focus/online repair, and
30-second fallback refreshes while degraded. When the socket is down, RPC falls
back to `fetch` on the same method+path so the UI stays usable. The UI shows the
connection state in the application shell.

Run detail uses a `run` channel subscription for activity/timeline. Durable
`work_events.sequence` and in-process live output ids are namespaced so they
never collide.

## Work ledger events

`work_events` (distinct from `platform_change_events`) is the per-item append-only
ledger. It is not pruned. Narrative types (`source.observed`, `work.stale`,
`run.progress`, …) keep their JSON payloads. `work.state_changed` additionally
stores status axes in dedicated nullable columns (`execution`, `delivery`,
`outcome`, `attention`, `sync_state`, `resolution`, `archived_at`) so status
counts can be replayed without parsing JSON. Any future pruning of `work_events`
must never drop the latest state-bearing row for a live work item.

## Boundaries

- Platform events invalidate API queries; they are not an alternate entity
  store or audit log.
- `work_events` remain semantic work timelines. Platform events are broad,
  short-lived read-model invalidations.
- A mutation path that changes a visible count or list must emit the matching
  topic in the same service operation whenever practical.
- Views refresh from canonical HTTP/RPC endpoints instead of applying event
  payloads as local patches.
