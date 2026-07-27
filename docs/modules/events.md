# Module: platform events

**Paths:** `src/shared/events.ts`, `src/events/`, `src/storage/platform-events.ts`,
`web/src/lib/platform-events.ts`, `web/src/composables/useLiveQuery.ts`

## Responsibility

Platform change events invalidate operator-facing read models when durable state
changes. They do not duplicate the full entity. Each event identifies the
project, entity, mutation type, affected UI topics, occurrence time, and a
monotonic SQLite sequence.

`platform_change_events` is a durable, bounded changelog. It retains seven days
and at most 50,000 events. The sequence is the reconnect cursor; events are
replayed in order after daemon restarts.

## Delivery contract

- `GET /api/v1/events` is the authenticated global SSE stream.
- `GET /api/v1/projects/:id/events` is a project-scoped compatibility alias.
- `Last-Event-ID` or `after` resumes after a known sequence.
- Repeatable `topic` parameters filter replay and live delivery.
- In-process subscribers wake streams immediately; a five-second database
  repair loop catches changes written by another CLI process.

Topics are read-model boundaries: `dashboard`, `overview`, `impact`, `queue`,
`runs`, `tasks`, `schedules`, `projects`, `work`, and `sources`.

## Producers

Run lifecycle, dispatcher-visible state, integration reconciliation, source
sync/webhooks, project/task/schedule mutations, and instance scheduling changes
append targeted invalidations after their durable mutation.

## Browser behavior

The Vue shell owns one shared `EventSource`. Views subscribe by topic and
optionally project, coalesce bursts, and serialize refreshes. The last valid
sequence is kept in session storage. Disconnects use exponential reconnect,
focus/online repair, and 30-second fallback refreshes while degraded. The UI
shows the connection state in the application shell.

## Boundaries

- Platform events invalidate API queries; they are not an alternate entity
  store or audit log.
- `work_events` remain semantic work timelines. Platform events are broad,
  short-lived read-model invalidations.
- A mutation path that changes a visible count or list must emit the matching
  topic in the same service operation whenever practical.
- Views refresh from canonical HTTP endpoints instead of applying event payloads
  as local patches.
