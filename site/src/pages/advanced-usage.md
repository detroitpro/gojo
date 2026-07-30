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

## Approval before merge

For anything that touches production branches:

```yaml
integration:
  mode: pull-request
  targetBranch: main
  prTool: tea # or gh
  prLogin: home
  prRemote: origin
  # Optional Forgejo auto-merge after create (daemon needs FORGEJO_TOKEN / GOJO_FORGEJO_TOKEN):
  prAutoMerge: true
  prApiUrl: http://192.168.5.251:3001
  prRepo: detroitpro/rhystic-gaming
  prMergeStyle: squash
  requireAllValidations: true
```

Use `pull-request` in `gojo.yaml` so merges wait on review or CI. Set `prTool: tea` (and usually `prLogin`) for Forgejo/Gitea hosts. `prAutoMerge` schedules merge when checks succeed (same idea as Rhystic `make pr`); it does not bypass CI. The runtime also supports `await-approval` (commit on the run branch, then pause for UI / `gojo run approve|reject` without opening a PR), but that mode is **not** accepted in manifests yet — stick to `pull-request` until the schema adds it. Auto-merge only for narrow, trusted agents.

## Secrets without committing them

1. Store tokens in gojo's encrypted secret store (CLI/API — values never go in `gojo.yaml`).
2. Reference them by name from the instance/profile environment at execution time.
3. Rely on redaction in logs and handoffs.

Manifests should contain **references**, not raw API keys.

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
