---
layout: ../layouts/DocLayout.astro
title: Advanced usage
description: Patterns beyond the first agent — multi-role agents, approval gates, secrets, overlap policies, and production hygiene.
---

Use this page once [Getting started](/getting-started) and [Your first agent](/first-agent) work. For a full AI-coded example, see [Advanced agent](/advanced-agent).

## Multi-role agents in one project

Define more than one profile: a writer that edits code, a read-only reviewer, a shell adapter for deterministic chores.

```yaml
agents:
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

Point each **task** at the right `agent`. Keep high-privilege secrets off the reviewer profile.

## Approval before merge

For anything that touches production branches:

```yaml
integration:
  mode: pull-request
  targetBranch: main
  requireAllValidations: true
```

Use `pull-request` in `gojo.yaml` so merges wait on human review. The runtime also supports `await-approval` (commit on the run branch, then pause for UI / `gojo run approve|reject` without opening a PR), but that mode is **not** accepted in manifests yet — stick to `pull-request` until the schema adds it. Auto-merge only for narrow, trusted tasks.

## Secrets without committing them

1. Store tokens in gojo’s encrypted secret store (CLI/API — values never go in `gojo.yaml`).
2. Reference them by name from the instance/agent environment at execution time.
3. Rely on redaction in logs and handoffs.

Manifests should contain **references**, not raw API keys.

## Overlap and concurrency

Long AI runs often exceed the schedule interval. Prefer:

```yaml
concurrency:
  projectLimit: 1
  overlapPolicy: skip    # or queue — avoid allow_parallel on the same repo
```

One maintenance task rewriting the lockfile while another runs is how you get invalid “green” results.

## Failure policy that pages humans

```yaml
failurePolicy:
  maxAttemptsPerRun: 2
  disableAfterConsecutiveFailedRuns: 3
  backoff: exponential
```

`maxAttemptsPerRun` retries agent/validation failures under the **same run** (new attempts, with optional backoff). `disableAfterConsecutiveFailedRuns` is wired onto the schedule’s auto-disable threshold on sync.

Pair with notifications `onDisabled` so a broken weekly job doesn’t fail quietly forever.

## Self-healing

Wire `selfHeal` on flaky maintenance tasks and ship an in-repo healer that opens a reviewable PR. Full guide: **[Self-healing](/self-healing)** (platform plumbing vs. per-project brain, propagation, loop guards, templates).

## Richer validation

Treat validation as your CI subset for agent output:

- Frozen lockfile installs
- Lint + typecheck
- Unit tests, then a short integration smoke
- Optional security scan step

Keep steps ordered; fail fast. Timeouts should be shorter than the agent timeout so a stuck test doesn’t look like a stuck model.

## Constrained limits in every prompt

Unattended tasks need **hard numeric caps** in the prompt (max tests, files, dependency bumps, PRs), not only agent timeouts. Start tight; ratchet up after the schedule is stable.

Full guide: **[Task prompt best practices](/task-prompts)**.

## Handoffs for continuing work

Require `.gojo/handoff.json` in the prompt. Next week’s agent (or a human) should see:

- What upgraded / what was deferred
- Known breakages
- Recommended follow-up tasks (e.g. “major upgrade for package Y”)

Don’t paste full prior transcripts into every prompt — use the handoff summary ([Concepts](/concepts)).

## Repo instructions

```yaml
instructions:
  files:
    - AGENTS.md
    - docs/architecture.md
  scheduledRunNotice: |
    Unattended scheduled run. Prefer small diffs. Write .gojo/handoff.json.
```

Architecture notes reduce “creative” refactors during dependency chores.

## Operating hygiene

| Practice | Why |
| --- | --- |
| `gojo server doctor` after agent CLI upgrades | Catch broken adapters early |
| Global pause during incidents | Stop the scheduler without uninstalling |
| Backups before major gojo upgrades | DB + secrets + config |
| Localhost bind + proxy | Don’t expose raw agent execution to the internet |
| Separate tasks for “analyze only” vs “edit” | Different integration modes and secrets |

## CLI workflows that scale

```bash
gojo agent detect --output json
gojo task run <id> --output json
gojo run logs <run-id>
gojo schedule next <schedule-id>
gojo backup create
```

`run logs` prints the stored event history (snapshot). For live tailing, use the Runs UI or `GET /api/v1/runs/<id>/events` (SSE).

Script against `--output json` for chatops or custom dashboards; the HTTP API mirrors the same operations.

## Related

- [Task prompt best practices](/task-prompts) — start with constrained limits
- [Self-healing](/self-healing) — heal triggers, propagation, healer templates
- [Advanced agent](/advanced-agent) — concrete dependency-maintenance example
- [Settings](/settings) — field-by-field reference
- [CLI](/cli) — command map
- [FAQ](/faq) — common pitfalls
