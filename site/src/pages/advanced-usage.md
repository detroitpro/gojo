---
layout: ../layouts/DocLayout.astro
title: Advanced usage
description: Patterns beyond the first agent — multi-role profiles, approval gates, secrets, overlap policies, and production hygiene.
---

Use this page once [Getting started](/getting-started) and [Your first agent](/first-agent) work. For a full AI-coded example, see [Advanced agent](/advanced-agent).

## Multi-role profiles in one project

Define more than one profile: a writer that edits code, a read-only reviewer, a shell adapter for deterministic chores.

```yaml
profiles:
  maintenance:
    adapter: claude-code
    timeout: 45m
  reviewer:
    adapter: cursor
    timeout: 30m
    readOnly: true
  scripts:
    adapter: shell
    timeout: 10m
```

Point each **agent** at the right `profile`. Keep high-privilege secrets off the reviewer profile.

## Native forge auto-merge (low-risk agents)

For agents with a small blast radius (for example a date/time bump), enable the
forge’s merge-when-checks-succeed path per agent:

```yaml
integration:
  mode: pull-request
  targetBranch: main
  prTool: tea
  prApiUrl: http://192.168.5.251:3001
  prRepo: detroitpro/rhystic-gaming
  prMergeStyle: squash
  prAutoMerge: true
```

Gojo schedules native auto-merge through the source adapter after the PR opens
and skips the checks-settled reviewer. Use `approval: reviewer` (without
`prAutoMerge`) when an independent agent verdict is required before merge.

## Self-hosted forge API URL

When the git remote host is not the Forgejo/Gitea HTTP API (common for SSH
remotes on a non-443 port), set the project-level source API URL once:

```yaml
source:
  apiUrl: http://192.168.5.251:3001
```

Gojo uses this for source sync, approvals, and platform merges. Per-agent
`integration.prApiUrl` is still required for the tea CLI when opening PRs.

## Approval before merge

For anything that touches production branches:

```yaml
source:
  apiUrl: http://192.168.5.251:3001
agents:
  maintain-quality:
    integration:
      mode: pull-request
      targetBranch: main
      prTool: tea # or gh
      prLogin: home
      prRemote: origin
      prApiUrl: http://192.168.5.251:3001
      prRepo: detroitpro/rhystic-gaming
      prMergeStyle: squash
      approval: reviewer
      autonomyLabels:
        auto: gojo:auto-merge
      fixRounds: 2
      requireAllValidations: true
```

Use `pull-request` so the coding agent can push and exit. Gojo durably polls
source checks; no model process waits for CI. Once checks settle, an independent
reviewer agent supplies a verdict. The platform—not either agent—revalidates
checks and performs the merge through the source adapter.

`approval: reviewer` merges after green checks and a passing reviewer verdict.
`approval: manual` additionally requires an operator decision from Approvals,
CLI/API, or a trusted `/gojo approve` forge comment. An issue carrying the
configured `gojo:auto-merge` label upgrades reviewer authority to auto authority;
checks and reviewer pass are still mandatory. `fixRounds` bounds automatic
repairs for red CI or requested changes.

This is **`pull-request` mode** with a durable approval record on the opened PR.
For a human gate **before any post-validation integration**, use
`integration.mode: await-approval` instead: gojo commits on the run branch,
pauses in `AwaitingApproval`, and continues with `postApprovalMode` after
`gojo run approve` (default `auto-merge`; set `postApprovalMode: pull-request`
to open a PR only after approval). See [Settings → Integration modes](/settings).

## Issue-driven coding away from the workstation

Use a trusted `gojo:ready` label to move an actionable issue through triage,
implementation, asynchronous CI, independent review, bounded repair, and a
platform-owned merge. Coding and reviewer agents never receive the source merge
token managed by Gojo or remain running while checks execute. Host-level CLI,
SSH, and Git credentials remain part of the adapter host's trust boundary.

See [Issue-driven agents](/issue-driven-agents) for the complete three-agent
manifest, source-token and label setup, prompt responsibilities, approval modes,
remote forge commands, operating views, and troubleshooting.

## Secrets without committing them

Prefer per-agent allowlisted dotenv loading from the project's primary checkout (gitignored `.env` files are not present in run worktrees):

```yaml
agents:
  karakeep-catalog:
    # …
    environment:
      file: .env
      include:
        - KARAKEEP_API_URL
        - KARAKEEP_API_KEY
      required:
        - KARAKEEP_API_KEY
```

Rules:

1. List only the keys that agent needs under `include` — unlisted file keys are never injected.
2. Put secrets in the repo's gitignored `.env` (or another relative file under the registered checkout). Never put raw API keys in `gojo.yaml`.
3. Gojo loads the file at run start from `project.repoPath`, injects selected values into the adapter and validation phases, and redacts those values from streamed output and failure artifacts.
4. Platform `GOJO_*` variables always win over file values. Short-lived `GOJO_API_TOKEN` is adapter-only.

Do **not** dump an entire project `.env` into the systemd unit — that would share every secret with every agent on the daemon.

## Overlap and concurrency

Long AI runs often exceed the schedule interval. Two layers apply:

1. **Schedule overlap** (`overlapPolicy` on the SQLite schedule — defaults to `skip`; not in `gojo.yaml` yet) — whether a cron tick enqueues while that schedule already has an active/queued run. Prefer `skip` or `queue`; avoid `allow_parallel` on the same repo.
2. **Instance admission** (Settings → Run admission, or `GET|PATCH /api/v1/instance/scheduling`) — global/per-project caps, start stagger, and optional load guard. Cron is a **suggested** start; the queue admits under those caps (defaults: 2 concurrent, 1 per project). See the **Queue** view for waiting positions.

Manifest `concurrency` is synced onto the agent row for intent, but **instance admission** is what serializes starts across projects.

One maintenance agent rewriting the lockfile while another runs is how you get invalid "green" results.

## Failure policy that pages humans

```yaml
failurePolicy:
  maxAttemptsPerRun: 2
  disableAfterConsecutiveFailedRuns: 3
  backoff: exponential
```

`maxAttemptsPerRun` retries adapter/validation failures under the **same run** (new attempts, with optional backoff). `disableAfterConsecutiveFailedRuns` is wired onto the schedule's auto-disable threshold on sync.

Pair with notifications `onDisabled` so a broken weekly agent doesn't fail quietly forever.

## Self-healing

Wire `selfHeal` on flaky maintenance agents and ship an in-repo healer that opens a reviewable PR. Full guide: **[Self-healing](/self-healing)** (platform plumbing vs. per-project brain, propagation, loop guards, templates).

## Richer validation

Treat validation as your CI subset for adapter output:

- Frozen lockfile installs
- Lint + typecheck
- Unit tests, then a short integration smoke
- Optional security scan step

Keep steps ordered; fail fast. Timeouts should be shorter than the profile timeout so a stuck test doesn't look like a stuck model.

## Constrained limits in every prompt

Unattended agents need **hard numeric caps** in the prompt (max tests, files, dependency bumps, PRs), not only profile timeouts. Start tight; ratchet up after the schedule is stable.

Full guide: **[Agent prompt best practices](/agent-prompts)**.

## Handoffs for continuing work

Require `.gojo/handoff.json` in the prompt. Next week's run (or a human) should see:

- What upgraded / what was deferred
- Known breakages
- Recommended follow-up agents (e.g. "major upgrade for package Y")

Don't paste full prior transcripts into every prompt — use the handoff summary ([Concepts](/concepts)).

## Repo instructions

```yaml
instructions:
  files:
    - .gojo/instructions.md
  scheduledRunNotice: |
    Unattended scheduled run. Prefer small diffs. Write .gojo/handoff.json.
```

gojo prepends the notice and listed files to every **AI** agent prompt at run time (shell scripts are unchanged). Put shared qualities and handoff judgment in the file; keep numeric limits in each `promptFile`. See [Agent prompt best practices](/agent-prompts).

## Operating hygiene

| Practice | Why |
| --- | --- |
| `gojo server doctor` after adapter CLI upgrades | Catch broken adapters early |
| Global pause during incidents | Stop the scheduler without uninstalling |
| Backups before major gojo upgrades | DB + secrets + config |
| Localhost bind + proxy | Don't expose raw adapter execution to the internet |
| Separate agents for "analyze only" vs "edit" | Different integration modes and secrets |

## CLI workflows that scale

```bash
gojo adapter detect --output json
gojo agent run <id> --output json
gojo run logs <run-id>
gojo schedule next <schedule-id>
gojo backup create
```

`run logs` prints the stored event history (snapshot). For live tailing, use the Runs UI (WebSocket run channel on `/api/v1/ws`).

Script against `--output json` for chatops or custom dashboards; the HTTP API mirrors the same operations.

## Related

- [Agent prompt best practices](/agent-prompts) — start with constrained limits
- [Self-healing](/self-healing) — heal triggers, propagation, healer templates
- [Advanced agent](/advanced-agent) — concrete dependency-maintenance example
- [Settings](/settings) — field-by-field reference
- [CLI](/cli) — command map
- [FAQ](/faq) — common pitfalls
