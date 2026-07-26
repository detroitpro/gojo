---
layout: ../layouts/DocLayout.astro
title: Settings reference
description: What each major gojo setting controls — instance, projects, agents, schedules, validation, integration, secrets, and notifications.
---

This page is a consumer-facing map of the knobs that matter day to day. Defaults favor a single local instance on localhost.

## Instance

Configured in `~/.gojo/config/instance.yaml` and the **Settings** screen.

| Setting | What it does | When to change |
| --- | --- | --- |
| **Bind host / port** | Where the API and web UI listen (default `127.0.0.1:7430`) | Only when exposing behind a reverse proxy or tunnel — never open `0.0.0.0` without auth and TLS |
| **Global pause** | Stops new scheduled work; emergency stop | Incidents, maintenance, runaway agents |
| **Telemetry** | Structured spans/metrics logging | Enable when shipping logs to a collector |

Also use **backup** commands to snapshot database, config, and secret key material:

```bash
bun run gojo backup create
bun run gojo backup verify
bun run gojo backup restore <archive>
```

## Projects & repository manifest

A **project** is a registered Git repository path plus runtime state in SQLite.

The optional **`gojo.yaml`** (or `.gojo/project.yaml`) describes desired behavior: agents, tasks, validation profiles, schedules, notifications. **Sync** copies that desired state into the database. The database remains authoritative for runs and schedule counters.

| Area | Meaning |
| --- | --- |
| `project.defaultBranch` | Target branch for integration |
| `repository.syncBeforeRun` | Fetch + fast-forward base from origin, then re-sync the manifest before preparing a worktree (required for merged healer PRs to take effect) |
| `repository.requireCleanBase` | Refuse dirty base clones |
| `instructions` | `files` + `scheduledRunNotice` prepended to AI task prompts at run time (shell skipped; missing files fail the run) |

Conflicts between manifest and admin overrides should stay visible in audit/history.

## Agents

Each **agent profile** picks an adapter (`shell`, `cursor`, `claude-code`), timeout, and optional model/permissions.

| Concern | Guidance |
| --- | --- |
| Detection | `gojo agent detect` / UI **Agents** — installed, version, auth when applicable |
| Timeouts | Keep tighter than “hope it finishes”; platform cancels and cleans up |
| Permissions | Scope filesystem/shell/network in the profile; don’t hand production deploy secrets to a docs task |
| Versions | Recorded per attempt; unexpected CLI upgrades can change behavior |

## Tasks

A **task** is the unit of work: prompt, agent, validation profile, concurrency, integration, failure policy. Separate from **schedules** so the same task can run manually or on a timer.

| Field | Role |
| --- | --- |
| `promptFile` | Instructions or script content delivered to the adapter — write with [constrained limits](/task-prompts) |
| `validationProfile` | Ordered checks after the agent exits |
| `concurrency` | Stored on the task row at sync (`projectLimit`, `overlapPolicy: skip \| queue \| cancel`) — **not enforced by the coordinator yet**; overlap today is per **schedule** row (see below) |
| `integration` | What happens to Git after validation |
| `failurePolicy` | `maxAttemptsPerRun`, `backoff`, schedule disable threshold |
| `selfHeal` | Optional `{ task, afterConsecutiveFailedRuns? }` — enqueue an in-repo healer on failure (see [Self-healing](/self-healing)) |

## Schedules

| Setting | Role |
| --- | --- |
| **Cron + timezone** | When the task should fire (DST-aware) |
| **Enabled** | Pause without deleting history |
| **Overlap policy** | `skip` / `queue` / `cancel_replace` / `allow_parallel` — per schedule row in SQLite (defaults to `skip`); enforced by the scheduler; **not** in `gojo.yaml` today |
| **Missed-run policy** | `skip` / `run_once` / `run_all` / `run_latest` after downtime — same storage as overlap (defaults to `skip` at create; scheduler falls back to `run_latest` only when the stored value is invalid) |
| **Retries / backoff** | Distinguish infra blips from real task failure |
| **Disable after N failures** | Auto-stop noisy schedules and notify |

Default bias: queue carefully, disable after a few consecutive failures, require explicit re-enable.

## Validation

Validation runs **outside** the agent process as a list of shell commands with timeouts.

Use it for: install, lint, test, build, security scans, repo-specific gates.

Empty profile = pass (useful for pure analysis). Failed required steps fail the run before integration.

## Integration modes

| Mode | In `gojo.yaml`? | Behavior |
| --- | --- | --- |
| *(omit `integration`)* | yes | No commit; reporting only (`none` at runtime) |
| **commit-only** | yes | Commit on the run branch; do not merge |
| **pull-request** | yes | Push branch and open a PR (`gh` when available, else a local placeholder URL) |
| **auto-merge** | yes | Merge into the target under the project merge lock after checks |
| **await-approval** | no (runtime/API only today) | Commit, then wait for operator approve/reject in the UI or via `gojo run approve\|reject` |

Agents should not `git push origin main`. The **merge queue** serializes integration and re-checks the target branch.

## Secrets

- Stored encrypted at rest; referenced by name, not pasted into manifests
- Injected only at execution time; redacted from logs and handoffs
- Prefer project-scoped secrets for repo-specific tokens

## Notification channels

Manifest routes name channels (`onSuccess`, `onFailure`, `onDisabled`). Channel endpoints (webhook URLs, Slack hooks) are configured on the instance under **Settings → Notification channels**, not committed to git.

See [Notifications](/notifications) for the guided setup, provider webhook URLs, test sends, delivery retries, and auto-disable routing.

## Security defaults worth keeping

- Localhost bind until you deliberately expose the port
- Auth required after first setup
- Global and per-project pause
- Minimal environment for agent subprocesses
- Don’t let agents edit gojo’s own config, service units, or other projects

## Related

- [Notifications](/notifications) — channels, routing, and delivery
- [Concepts](/concepts) — run lifecycle and ownership boundaries
- [CLI](/cli) — command map for the same settings
- [FAQ](/faq) — “why can’t I …?”
