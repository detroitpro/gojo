# Module: scheduler

**Path:** `src/scheduler/`

## Responsibility

Evaluate cron/schedules, overlap policies, missed-run catch-up, retries, and auto-disable. **Create or trigger runs**—do not execute agents.

Includes cron helpers, disable/outcome recording, and policy checks.

## Schedule-row policies (SQLite)

Each schedule stores policies the tick loop reads (not synced from `gojo.yaml` today):

| Field | Values | Default at create |
| --- | --- | --- |
| `overlapPolicy` | `skip`, `queue`, `cancel_replace`, `allow_parallel` | `skip` |
| `missedRunPolicy` | `skip`, `run_once`, `run_all`, `run_latest` | `skip` |

Overlap counts active/queued runs **for that schedule** before calling `onTrigger`. Task `concurrencyJson` from the manifest is separate and is not read here.

## May call

- `storage/` for schedules and run records
- Run creation APIs / coordinator entrypoints that only **enqueue** work

## Must not

- Invoke agent CLIs or shell task scripts directly
- Perform Git worktree setup
- Merge branches or open PRs

## PRD

- [§12 Scheduling Requirements](../../PRD.md#12-scheduling-requirements)
- [§23 Reference Architecture](../../PRD.md#23-reference-architecture) — scheduler must not call agents
- [§3.5 Scheduled work must be safe to stop](../../PRD.md#35-scheduled-work-must-be-safe-to-stop)
