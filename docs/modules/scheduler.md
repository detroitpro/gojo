# Module: scheduler

**Paths:** `src/contexts/scheduling/`, pilot context `src/contexts/scheduling/`

## Responsibility

Evaluate cron/schedules, overlap policies, missed-run catch-up, retries, and auto-disable. **Enqueue runs only**—do not execute adapters or admit work.

Overlap / missed-run pure policies and instance scheduling-policy use cases live in
`src/contexts/scheduling/` (see [`docs/architecture/context-template.md`](../architecture/context-template.md)).
HTTP/CLI for instance scheduling policy go through the platform registry
(`scheduling.policy.get` / `scheduling.policy.set`). Removable leftovers:
[`removal-backlog.md`](../architecture/removal-backlog.md).

Cron fire times are **suggested starts** (`notBeforeAt`). The run **dispatcher** (`src/contexts/execution/application/dispatcher.ts`) admits queued runs under the instance scheduling policy. Scheduled runs also get `expiresAt` = the next cron occurrence after the fire time; if they never get a slot, the dispatcher marks them `Skipped`.

Includes cron helpers, disable/outcome recording, and policy checks.

## Schedule-row policies (SQLite)

Each schedule stores policies the tick loop reads (not synced from `gojo.yaml` today):

| Field | Values | Default at create |
| --- | --- | --- |
| `overlapPolicy` | `skip`, `queue`, `cancel_replace`, `allow_parallel` | `skip` |
| `missedRunPolicy` | `skip`, `run_once`, `run_all`, `run_latest` | `skip` |

Overlap counts active/queued runs **for that schedule** before calling `onTrigger`:

| Decision | Behavior |
| --- | --- |
| `skip` | Do not enqueue while an active (or already queued, for `queue` coalescing) run exists |
| `queue` | Enqueue anyway; per-project admission serializes execution |
| `cancel_replace` | Cancel the schedule’s active runs via `onCancelActive`, then enqueue |
| `allow_parallel` | Always enqueue |

Agent `concurrencyJson` from the manifest is synced onto the agent (work-unit) row but **instance-level** admission (`maxConcurrentRuns` / `maxConcurrentRunsPerProject` in `instance_settings.scheduling_policy`) is what gates starts.

## Integration-outcome reconciliation hook

Each tick optionally invokes the injected `reconcileIntegrations(now)` callback (wired to `contexts/delivery/application/status-reconciler.ts` in `platform/app-context.ts`). The scheduler only invokes it — batching, exponential backoff, and Forgejo/GitHub specifics live in the delivery module. It runs even while the instance is paused because it is a passive read of external PR state.

## May call

- `infrastructure/persistence/` repository ports for schedules and run records
- Run creation APIs / coordinator entrypoints that only **enqueue** work
- The injected integration-status reconciliation callback (invoke-only)

## Must not

- Invoke adapter CLIs or shell agent scripts directly
- Perform Git worktree setup
- Merge branches or open PRs

## PRD

- [§12 Scheduling Requirements](../../PRD.md#12-scheduling-requirements)
- [§23 Reference Architecture](../../PRD.md#23-reference-architecture) — scheduler must not call adapters
- [§3.5 Scheduled work must be safe to stop](../../PRD.md#35-scheduled-work-must-be-safe-to-stop)
