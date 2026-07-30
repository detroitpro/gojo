---
layout: ../layouts/DocLayout.astro
title: Self-healing
description: How gojo recovers from failed agents — platform plumbing, per-project healer agents, propagation, and loop guards.
---

Failed runs are normal. Self-healing is how gojo turns a durable failure into a **reviewable fix in the project repo**, without gojo inventing domain knowledge for every project.

## Split of responsibility

| Layer | Owns | Lives in |
| --- | --- | --- |
| **Platform plumbing** | Retries, API access for the adapter subprocess, failure artifacts, heal trigger, fetch + re-sync before runs | gojo daemon (`src/`) |
| **Healing logic** | Diagnosis, edits to prompts/manifest/validation/code, opening a PR | Each project's `self-heal` agent (git) |

**Why the split?** `gojo project sync` overwrites agent prompts and policies from `gojo.yaml`. A "fix" that only edits the SQLite database is erased on the next sync. Fixes that should stick must be committed in the repo.

gojo can heal **itself** the same way: register the gojo checkout as a project (this repo ships a dogfood [`gojo.yaml`](https://github.com/detroitpro/gojo/blob/main/gojo.yaml)).

## What the platform does

### Retries under one run

```yaml
failurePolicy:
  maxAttemptsPerRun: 2
  backoff: exponential   # exponential | linear | none
  disableAfterConsecutiveFailedRuns: 3
```

- Adapter or validation failure creates a **new attempt** under the same run (history kept).
- `disableAfterConsecutiveFailedRuns` is copied onto the schedule's auto-disable threshold when you sync.

### Adapter environment

Every adapter invocation receives:

| Env var | Purpose |
| --- | --- |
| `GOJO_API_URL` | Base API URL (e.g. `http://127.0.0.1:7430/api/v1`) |
| `GOJO_API_TOKEN` | Short-lived bearer token **scoped to this run only** |
| `GOJO_RUN_ID` | Current run |
| `GOJO_AGENT_ID` / `GOJO_PROJECT_ID` | Current agent (work unit) and project |

`GOJO_API_TOKEN` may call **only** `POST $GOJO_API_URL/runs/$GOJO_RUN_ID/progress` (structured focus updates while the run is active). It cannot list runs, read artifacts, or call other API routes — use the CLI or artifact files for diagnosis.

Typical healer diagnostics (same machine as the daemon; `gojo` on `PATH`):

```bash
gojo run list --project "$GOJO_PROJECT_ID" --output json
gojo run inspect <failed-run-id> --output json
gojo run artifacts <failed-run-id> --output json
```

Artifacts also land under `~/.gojo/artifacts/<runId>/` (`failure.json`, `validation.json`, `handoff.json`) when the agent process can read the instance home.

### Failure artifacts

On failure, gojo writes under `~/.gojo/artifacts/<runId>/`:

- `failure.json` — error message, phase, agent/project names, optional validation summary
- `validation.json` — when validation was the failing stage (stdout/stderr per step)

Inspect with `gojo run artifacts <id>` or the Runs UI.

### Heal trigger

```yaml
agents:
  deps-dotnet:
    # …
    selfHeal:
      agent: self-heal
      afterConsecutiveFailedRuns: 1   # default 1
```

When the agent fails and the consecutive-failure threshold is met, gojo enqueues the named healer with `trigger: heal`.

### Propagation (merged fixes actually apply)

If the manifest has `repository.syncBeforeRun: true`, before preparing a worktree gojo:

1. `git fetch` and fast-forward the local base branch from `origin`
2. Re-sync `gojo.yaml` into the database

Without that, a merged healer PR would not update local `main` or the agent prompt until you sync manually.

## What each project should ship

1. A **healer agent** (prompt + validation + `pull-request` integration).
2. `selfHeal` on the agents you want repaired automatically.
3. Prefer **human review** of healer PRs (do not auto-merge).

Minimal shape:

```yaml
repository:
  remote: origin
  syncBeforeRun: true
  # …

profiles:
  cursor:
    adapter: cursor
    timeout: 30m

validationProfiles:
  self-heal:
    steps:
      - name: handoff-exists
        command: test -f .gojo/handoff.json
        timeout: 30s

agents:
  my-agent:
    # …
    selfHeal:
      agent: self-heal
      afterConsecutiveFailedRuns: 1

  self-heal:
    description: Diagnose failed runs and open a reviewable fix PR
    profile: cursor
    promptFile: .gojo/agents/self-heal.md
    validationProfile: self-heal
    concurrency:
      projectLimit: 1
      overlapPolicy: skip
    integration:
      mode: pull-request
      targetBranch: main
      requireAllValidations: true
    failurePolicy:
      maxAttemptsPerRun: 1
      backoff: none
```

The healer prompt should:

1. List recent failed runs via `gojo run list` / `gojo run inspect` (or read `failure.json` under `$GOJO_HOME/artifacts/`)
2. Read `failure.json` / `validation.json`
3. Edit in-repo config (or narrowly scoped code)
4. Re-run the failing validation command when practical
5. Leave a PR for humans — never weaken CI to force green

See this repo's [`.gojo/agents/self-heal.md`](https://github.com/detroitpro/gojo/blob/main/.gojo/agents/self-heal.md) as a starting template.

## Loop guards

| Guard | Behavior |
| --- | --- |
| Heal does not re-heal | Runs with `trigger: heal` never enqueue another healer |
| Healer excluded | If the failing agent **is** the healer, no heal is enqueued |
| Preflight / infra | Runs that never started (`startedAt` null) or hit an invalid state transition are skipped — no healer for workspace prep or daemon infra failures |
| Cap | At most **3** heal runs per project per hour |

## Lifecycle sketch

```text
Agent fails (after maxAttemptsPerRun exhausted)
  → failure.json written
  → if selfHeal configured and guards pass → enqueue healer (trigger=heal)
  → healer opens PR (pull-request mode)
  → human reviews + merges
  → next run: syncBeforeRun fetch/ff + manifest sync
  → agent runs with the fix
```

## Related

- [Advanced usage](/advanced-usage) — failure policy, concurrency, approvals
- [Settings](/settings) — manifest fields
- [Concepts](/concepts) — runs vs attempts
- [FAQ](/faq) — “schedule disappeared” and other ops questions
