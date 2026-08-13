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
| **Schedule** | `schedules:` in `gojo.yaml` | When an agent runs (cron + timezone; overlap policy is per-schedule in SQLite, not manifest) |

## Instance

Configured in `~/.gojo/config/instance.yaml` and the **Settings** screen.

| Setting | What it does | When to change |
| --- | --- | --- |
| **Bind host / port** | Where the API and web UI listen (default `127.0.0.1:7430`) | LAN bind or origin for a tunnel — run `gojo setup` on loopback first |
| **Public base URL** | Canonical URL for the browser UI and CSRF. Adapters receive `GOJO_API_URL` as `apiBaseUrl` (`<publicBaseUrl>/api/v1`; loopback default `http://127.0.0.1:7430/api/v1`) — see `gojo instance show` | Required when bind is not loopback — e.g. `https://gojo.example.com` or `http://192.168.x.x:7430` |
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

### Editor autocomplete for `gojo.yaml`

A JSON Schema is published from `main` at
`https://raw.githubusercontent.com/detroitpro/gojo/main/packages/contracts/schemas/gojo.project.schema.json`
(generated from the same Zod contract Sync uses; also served from this site at
[`/schemas/gojo.project.schema.json`](/schemas/gojo.project.schema.json)). With the Red Hat YAML
extension (or any YAML Language Server client):

1. **Modeline** — first line of the file:
   `# yaml-language-server: $schema=https://raw.githubusercontent.com/detroitpro/gojo/main/packages/contracts/schemas/gojo.project.schema.json`
2. **Workspace settings** — map that URL under `yaml.schemas` to `gojo.yaml` /
   `.gojo/project.yaml`.
3. **Schema Store** — when the catalog entry is live, matching `gojo.yaml` by
   filename needs no per-repo setup (`yaml.schemaStore.enable` defaults to on).

The schema rejects unknown properties (`additionalProperties: false`). Do not add
fields that are not documented here — for example `integration.commitMessage` is
**not** a manifest key; gojo builds commit/PR titles at run time.

Cross-field rules (for example `prAutoMerge` only with pull-request mode) remain
enforced at Sync time, not only in the editor.

Optional `enabled` flags (default `true` when omitted) are also applied on Sync — **YAML wins** over prior ops toggles:

| Location | Effect |
| --- | --- |
| `project.enabled` | Project-level gate: blocks new scheduled, work-trigger, heal, and API runs for the whole project (does not flip child agent/schedule rows) |
| `agents.<name>.enabled` | Sets that agent’s runtime `enabled` |
| `schedules.<name>.enabled` | Sets that schedule’s runtime `enabled` |

UI/CLI **Enable/Disable** write the database only (they do not edit the repo’s YAML). The next Sync reapplies the manifest if it disagrees.

### Projects UI

In the web UI, **Projects** is a list of registered repos. **Open** a project for sub-pages: **Overview** (needs attention, in-progress work, day-grouped **Recent changes** with copyable digest, and impact summary), **History** (completed and verified-terminal work), **Impact** (paged impact items), **Health** (doctor checklist), and **Configuration** (structured synced manifest — not a raw JSON dump). **Sync** reloads the manifest and shows counts (profiles / agents / schedules). **Enable/Disable** pauses or resumes new work for that project without unregistering it. **Remove** unregisters the project from gojo (CASCADE-deletes gojo history for that project) — it does **not** delete the git working tree (you confirm in a dialog first). Prefer Disable over Remove when you only want schedules to stop.

| Area | Meaning |
| --- | --- |
| `project.enabled` | When `false`, gate all new work for the project after Sync (or via ops Disable) |
| `project.defaultBranch` | Target branch for integration |
| `repository.syncBeforeRun` | Fetch + fast-forward base from origin, then re-sync the manifest before preparing a worktree (required for merged healer PRs to take effect) |
| `repository.requireCleanBase` | Refuse dirty base clones |
| `repository.submodules` | Manifest field only today — accepted in `gojo.yaml` but not yet applied at workspace prep (PRD §25.16) |
| `repository.gitLfs` | Manifest field only today — accepted in `gojo.yaml` but not yet applied at workspace prep (PRD §25.16) |
| `source.apiUrl` | Override the derived forge HTTP API URL when the git remote host differs (common for self-hosted Forgejo on a non-443 port) |
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

| Field | Role |
| --- | --- |
| `adapter` | Installed CLI id (`shell`, `cursor`, `claude-code`, …) |
| `model` | Optional model id passed to the adapter |
| `timeout` | Wall-clock cap (`30s`, `10m`, `1h`, …); platform cancels and cleans up |
| `readOnly` | Optional; when `true`, the adapter must not modify the worktree (typical for reviewer/triage profiles) |
| `permissions` | Optional filesystem/shell/network scope; don't hand production deploy secrets to a docs agent |

## Agents

An **agent** is the unit of work: prompt, profile, validation profile, concurrency, integration, failure policy. Separate from **schedules** so the same agent can run manually or on a timer.

### Agents UI

In the web UI, **Agents** lists synced agents with success rate and last run. **Open** an agent for read-only inspect: last-synced prompt, validation/integration/failure/concurrency/environment policy JSON (environment shows file path and variable **names** only), linked schedules, run-history strip, and manifest source paths (`repoPath`, `manifestPath`, `promptFile`). **Run now**, **Enable/Disable**, and links to filtered Runs/Schedules are ops shortcuts — edit `gojo.yaml` and the `promptFile` in the repo, then **Project Sync** to change agent config (`gojo agent inspect <id>` mirrors the API for scripting). Runtime Enable/Disable lasts until the next Sync if `agents.<name>.enabled` in YAML disagrees.

| Field | Role |
| --- | --- |
| `enabled` | Optional; default `true`. Sync sets the agent’s runtime enabled flag |
| `profile` | Name of a `profiles:` entry (adapter + timeout + model) |
| `promptFile` | Instructions or script content delivered to the adapter — write with [constrained limits](/agent-prompts) |
| `validationProfile` | Ordered checks after the adapter exits |
| `environment` | Optional `{ file, include[], required?[] }` — load allowlisted dotenv vars from the registered primary checkout into the adapter and validation phases (see [Advanced usage](/advanced-usage)) |
| `trigger` | Optional source-work contract: trusted issue labels or settled PR checks (see [Issue-driven agents](/issue-driven-agents)) |
| `concurrency` | Synced onto the agent row (`projectLimit`; manifest `overlapPolicy`: `skip` / `queue` / `cancel`) for intent documentation — **not** the same field as per-schedule overlap (`cancel_replace` / `allow_parallel`). **Starts** are gated by the instance **run admission** policy (Settings → Run admission / `GET /api/v1/instance/scheduling`). Per-schedule `overlapPolicy` still controls whether a cron tick enqueues while that schedule already has work |
| `integration` | What happens to Git after validation |
| `failurePolicy` | `maxAttemptsPerRun`, `backoff`, schedule disable threshold |
| `selfHeal` | Optional `{ agent, afterConsecutiveFailedRuns? }` — enqueue an in-repo healer on failure (see [Self-healing](/self-healing)) |
| `mergePolicy` | Optional `{ includeAgents, excludeAgents? }` — for merge/babysit agents; gojo injects allowed `gojo/run/<agent>/…` head prefixes at run time (see [Agent prompts](/agent-prompts)) |
| `notifications` | Optional per-agent routing block — **replaces** project-level `notifications` for that agent only (see [Notifications](/notifications)) |

`trigger.on: issue-label` supports `requireLabels`, `anyLabels`,
`excludeLabels`, `trustedActors`, and `maxOpenClaims`.
`trigger.on: pull-request-checks-settled` supports `fromAgents`. Source-triggered
runs snapshot the issue or PR as untrusted context instead of treating its body
as instructions.

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
| *(omit `integration`)* | yes | No commit; reporting only (`none` at runtime). Triggered triage/review agents can request validated source actions through handoff without opening a PR — see [Issue-driven agents](/issue-driven-agents). |
| **commit-only** | yes | Commit on the run branch; do not merge |
| **pull-request** | yes | Push branch and open a PR via `integration.prTool` (`gh` or `tea`; default `gh`). Missing CLI / create failure → run **fails** with `local://pr/<branch>` recorded on the attempt. Checks, reviewer verdict, approval, and merge then advance asynchronously through the platform control plane. |
| **auto-merge** | yes | Merge into the target under the project merge lock after checks |
| **await-approval** | yes | Commit on the run branch, then pause in `AwaitingApproval` until an operator approves or rejects in the UI or via `gojo run approve\|reject`. After approval, integration continues with `postApprovalMode` (`commit-only`, `pull-request`, or `auto-merge`; default `auto-merge`) |

Adapter subprocesses should not `git push origin main`. The **merge queue** serializes integration and re-checks the target branch.

For `pull-request`, `approval: manual|reviewer|auto`,
`autonomyLabels.auto`, and `fixRounds` configure the durable approval and
bounded repair policy. Forge-specific fields: `prTool` (`gh` | `tea`; default
`gh`), optional `prLogin` / `prRemote` / `prApiUrl` / `prRepo` / `prMergeStyle`
for tea/Forgejo hosts, and `prAutoMerge: true` to schedule native
merge-when-checks-succeed (skips the checks-settled reviewer). See
[Advanced usage](/advanced-usage).

## Secrets

- Stored encrypted at rest; referenced by name, not pasted into manifests
- Injected only at execution time; redacted from logs and handoffs
- Prefer project-scoped secrets for repo-specific tokens
- Store source write tokens with `gojo source token set <source-id>`; Gojo strips its managed forge-token environment keys from agent and validation processes
- New private GitHub projects still need a project-scoped token even when a shared `github.com` connection already uses `tokenSecretName: source-github`. Use `GOJO_SOURCE_TOKEN="$(gh auth token)" gojo source token set <source-id> --secret-name source-github`. Keep that secret name so other GitHub projects keep working; doctor/`gh` alone is not enough until the secret exists (sync can fall back to env/`gh`, but storing the project secret is the durable fix)

## Notification channels

Manifest routes name channels (`onSuccess`, `onFailure`, `onDisabled`,
`onApprovalNeeded`). Channel endpoints (webhook URLs, Slack hooks) are
configured on the instance under **Settings → Notification channels**, not
committed to git.

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
- Global instance pause (Settings) and per-project / per-agent / per-schedule `enabled` (YAML + ops toggles; Sync applies YAML)
- Minimal environment for adapter subprocesses
- Don't let adapters edit gojo's own config, service units, or other projects

## Related

- [Notifications](/notifications) — channels, routing, and delivery
- [Concepts](/concepts) — run lifecycle and ownership boundaries
- [CLI](/cli) — command map for the same settings
- [FAQ](/faq) — "why can't I …?"
