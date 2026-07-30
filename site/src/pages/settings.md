---
layout: ../layouts/DocLayout.astro
title: Settings reference
description: What each major gojo setting controls — instance, projects, profiles, agents, schedules, validation, integration, secrets, and notifications.
---

This page is a consumer-facing map of the knobs that matter day to day. Defaults favor a single local instance on localhost.

## Vocabulary

| Concept | Where | What it is |
| --- | --- | --- |
| **Adapter** | Installed CLI (shell / cursor / claude-code) — surfaced under **Adapters** (`gojo adapter detect`) | How gojo invokes an underlying coding-agent process |
| **Profile** | `profiles:` in `gojo.yaml` | A named `adapter` + timeout + model + permissions |
| **Agent** | `agents:` in `gojo.yaml` | A work unit: prompt, validation, integration, failure policy |
| **Schedule** | `schedules:` in `gojo.yaml` | When an agent runs (cron + timezone + overlap policy) |

## Instance

Configured in `~/.gojo/config/instance.yaml` and the **Settings** screen.

| Setting | What it does | When to change |
| --- | --- | --- |
| **Bind host / port** | Where the API and web UI listen (default `127.0.0.1:7430`) | LAN bind or origin for a tunnel — run `gojo setup` on loopback first |
| **Public base URL** | Canonical URL browsers and agents use (`GOJO_API_URL`) | Required when bind is not loopback — e.g. `https://gojo.example.com` or `http://192.168.x.x:7430` |
| **Trusted proxies** | Who may set `X-Forwarded-*` (token `cloudflare` expands to CF ranges; Tunnel often needs `127.0.0.1`) | When Cloudflare or another reverse proxy terminates TLS |
| **Allowed origins / IP allowlist / Cookie Secure** | CORS/CSRF origins, optional client IP lock, Secure cookie mode (`auto`/`always`/`never`) | Hardening remote access |
| **Global pause** | Stops new scheduled work; emergency stop | Incidents, maintenance, runaway agents |
| **Telemetry** | Structured spans/metrics logging | Enable when shipping logs to a collector |

TLS belongs at Cloudflare (or your reverse proxy). Gojo speaks HTTP on the bind address. After network changes, restart (`gojo service restart`). CLI: `gojo instance show` / `gojo instance set`.

Also use **backup** commands to snapshot database, config, and secret key material:

```bash
bun run gojo backup create
bun run gojo backup verify <archive>
bun run gojo backup restore <archive>
```

## Projects & repository manifest

A **project** is a registered Git repository path plus runtime state in SQLite.

Its repository is also attached as a visibility **source**. Additional GitLab,
Forgejo, tracker, incident, deployment, or generic webhook sources can be
attached without changing the project manifest. Source observations, freshness,
and provenance are explained in [Project visibility and sources](/project-visibility).

The optional **`gojo.yaml`** (or `.gojo/project.yaml`) describes desired behavior: profiles, agents, validation profiles, schedules, notifications. **Sync** upserts by name into the database and **soft-disables** agents and schedules missing from the manifest (rows are kept for history). Prefer frequency-free keys — put cadence in `cron` / `timezone` only (see [Agent prompts](/agent-prompts)).

### Projects UI

In the web UI, **Projects** is a list of registered repos. **Open** a project for overview, health (doctor checklist), and a structured view of the synced manifest (not a raw JSON dump). **Sync** reloads the manifest and shows counts (profiles / agents / schedules). **Remove** unregisters the project from gojo — it does **not** delete the git working tree (you confirm in a dialog first).

| Area | Meaning |
| --- | --- |
| `project.defaultBranch` | Target branch for integration |
| `repository.syncBeforeRun` | Fetch + fast-forward base from origin, then re-sync the manifest before preparing a worktree (required for merged healer PRs to take effect) |
| `repository.requireCleanBase` | Refuse dirty base clones |
| `instructions` | `files` + `scheduledRunNotice` prepended to AI agent prompts at run time (shell skipped; missing files fail the run) |

Conflicts between manifest and admin overrides should stay visible in audit/history.

## Adapters (detection)

**Adapters** is the top-level UI/CLI tab that lists installed agent adapters on the host.

| Concern | Guidance |
| --- | --- |
| Detection | `gojo adapter detect` / UI **Adapters** — installed, version, auth when applicable |
| Test | `gojo adapter test <name>` invokes a smoke run to prove wiring |
| Versions | Recorded per attempt; unexpected CLI upgrades can change behavior |

## Profiles

Each **profile** picks an adapter (`shell`, `cursor`, `claude-code`), timeout, and optional model/permissions. Agents reference a profile by name.

```yaml
profiles:
  maintenance:
    adapter: claude-code
    model: default
    timeout: 45m
```

| Concern | Guidance |
| --- | --- |
| Timeouts | Keep tighter than "hope it finishes"; platform cancels and cleans up |
| Permissions | Scope filesystem/shell/network in the profile; don't hand production deploy secrets to a docs agent |

## Agents

An **agent** is the unit of work: prompt, profile, validation profile, concurrency, integration, failure policy. Separate from **schedules** so the same agent can run manually or on a timer.

### Agents UI

In the web UI, **Agents** lists synced agents with success rate and last run. **Open** an agent for read-only inspect: last-synced prompt, validation/integration/failure/concurrency/environment policy JSON (environment shows file path and variable **names** only), linked schedules, run-history strip, and manifest source paths (`repoPath`, `manifestPath`, `promptFile`). **Run now**, **Enable/Disable**, and links to filtered Runs/Schedules are ops shortcuts — edit `gojo.yaml` and the `promptFile` in the repo, then **Project Sync** to change agent config (`gojo agent inspect <id>` mirrors the API for scripting).

| Field | Role |
| --- | --- |
| `profile` | Name of a `profiles:` entry (adapter + timeout + model) |
| `promptFile` | Instructions or script content delivered to the adapter — write with [constrained limits](/agent-prompts) |
| `validationProfile` | Ordered checks after the adapter exits |
| `environment` | Optional `{ file, include[], required?[] }` — load allowlisted dotenv vars from the registered primary checkout into the adapter and validation phases (see [Advanced usage](/advanced-usage)) |
| `concurrency` | Synced onto the agent row (`projectLimit`; manifest `overlapPolicy`: `skip` / `queue` / `cancel`) for intent documentation — **not** the same field as per-schedule overlap (`cancel_replace` / `allow_parallel`). **Starts** are gated by the instance **run admission** policy (Settings → Run admission / `GET /api/v1/instance/scheduling`). Per-schedule `overlapPolicy` still controls whether a cron tick enqueues while that schedule already has work |
| `integration` | What happens to Git after validation |
| `failurePolicy` | `maxAttemptsPerRun`, `backoff`, schedule disable threshold |
| `selfHeal` | Optional `{ agent, afterConsecutiveFailedRuns? }` — enqueue an in-repo healer on failure (see [Self-healing](/self-healing)) |

## Schedules

| Setting | Role |
| --- | --- |
| **Cron + timezone** | Suggested start time (DST-aware). The dispatcher admits when a slot is free; queued scheduled runs expire at the next cron occurrence if they never start |
| **Enabled** | Pause without deleting history |
| **Overlap policy** | `skip` / `queue` / `cancel_replace` / `allow_parallel` — per schedule row in SQLite (defaults to `skip`); controls enqueue-on-overlap; **not** in `gojo.yaml` today |
| **Missed-run policy** | `skip` / `run_once` / `run_all` / `run_latest` after downtime — same storage as overlap (defaults to `skip` at create; scheduler falls back to `run_latest` only when the stored value is invalid) |
| **Retries / backoff** | Distinguish infra blips from real agent failure |
| **Disable after N failures** | Auto-stop noisy schedules and notify |

Default bias: queue carefully, disable after a few consecutive failures, require explicit re-enable.

## Validation

Validation runs **outside** the adapter process as a list of shell commands with timeouts.

Use it for: install, lint, test, build, security scans, repo-specific gates.

Empty profile = pass (useful for pure analysis). Failed required steps fail the run before integration.

## Integration modes

| Mode | In `gojo.yaml`? | Behavior |
| --- | --- | --- |
| *(omit `integration`)* | yes | No commit; reporting only (`none` at runtime). Use for forge side-effect agents (e.g. issue label triage via `gh`) that must not open PRs — see [Agent prompts](/agent-prompts#report-only-agents-forge-side-effects). |
| **commit-only** | yes | Commit on the run branch; do not merge |
| **pull-request** | yes | Push branch and open a PR via `integration.prTool` (`gh` or `tea`; default `gh`). Missing CLI / create failure → run **fails** with `local://pr/<branch>` recorded on the attempt. With `prTool: tea` + `prAutoMerge: true` (+ `prApiUrl` / `prRepo`), enable Forgejo merge-when-checks-succeed using `GOJO_FORGEJO_TOKEN` or `FORGEJO_TOKEN` in the daemon environment (warning only if the token/API call fails). |
| **auto-merge** | yes | Merge into the target under the project merge lock after checks |
| **await-approval** | no (runtime/API only today) | Commit, then wait for operator approve/reject in the UI or via `gojo run approve\|reject` |

Adapter subprocesses should not `git push origin main`. The **merge queue** serializes integration and re-checks the target branch.

## Secrets

- Stored encrypted at rest; referenced by name, not pasted into manifests
- Injected only at execution time; redacted from logs and handoffs
- Prefer project-scoped secrets for repo-specific tokens

## Notification channels

Manifest routes name channels (`onSuccess`, `onFailure`, `onDisabled`). Channel endpoints (webhook URLs, Slack hooks) are configured on the instance under **Settings → Notification channels**, not committed to git.

See [Notifications](/notifications) for the guided setup, provider webhook URLs, test sends, delivery retries, and auto-disable routing.

## Account & authentication

After first setup there is a single local admin. Sign in with username/password (session cookie) or use an API token for automation.

| Control | Where | Notes |
| --- | --- | --- |
| **Change password** | Settings → Account, or `gojo auth password` | Requires the current password. Invalidates other browser sessions. API tokens keep working. |
| **API tokens** | Settings → Authentication | Create/revoke Bearer tokens (`gojo_…`). Prefer tokens for CI and scripts. |
| **Who am I** | `gojo auth whoami` | Lists local users (no password hashes). |

`gojo setup` cannot be re-run to rotate credentials — see [FAQ](/faq#can-i-run-setup-again-to-change-my-password).

## Security defaults worth keeping

- Localhost bind until you deliberately expose the port
- Auth required after first setup
- Global and per-project pause
- Minimal environment for adapter subprocesses
- Don't let adapters edit gojo's own config, service units, or other projects

## Related

- [Notifications](/notifications) — channels, routing, and delivery
- [Concepts](/concepts) — run lifecycle and ownership boundaries
- [CLI](/cli) — command map for the same settings
- [FAQ](/faq) — "why can't I …?"
