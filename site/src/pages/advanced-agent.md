---
layout: ../layouts/DocLayout.astro
title: Advanced agent
description: A production-shaped AI coding agent — dependency maintenance with Claude Code or Cursor, real validation, pull requests, schedules, and handoffs.
---

The [first agent](/first-agent) proves the pipeline with a shell script. This page shows a **real AI coding task**: review outdated dependencies, apply safe upgrades, run your test suite, and open a pull request — on a weekly schedule.

You need the **Claude Code** or **Cursor Agent** CLI installed and authenticated on the gojo host (`gojo agent detect`).

## What this agent does

1. Starts from an isolated worktree and branch.
2. Receives a detailed prompt (repo context, safety rules, handoff requirements).
3. Uses the coding agent to inspect and upgrade dependencies.
4. gojo runs **your** lint/test/build validation — not the agent’s self-report.
5. Opens a **pull request** (or waits for approval) instead of merging to `main`.
6. Writes a structured handoff so next week’s run (or a human) knows what was deferred.

## Manifest sketch

Add (or merge) into `gojo.yaml`:

```yaml
version: 1

project:
  name: billing-service
  defaultBranch: main

repository:
  remote: origin
  syncBeforeRun: true
  requireCleanBase: true
  submodules: false
  gitLfs: false

instructions:
  files:
    - AGENTS.md
    - docs/architecture.md
  scheduledRunNotice: |
    You are executing an unattended scheduled task.
    A future agent may inspect and continue this work.
    Produce a complete structured handoff report at .gojo/handoff.json.

agents:
  maintenance:
    adapter: claude-code   # or: cursor
    model: default
    timeout: 45m
    permissions:
      filesystem: project
      shell: allowlisted
      network: restricted

validationProfiles:
  standard:
    steps:
      - name: install
        command: pnpm install --frozen-lockfile
        timeout: 10m
      - name: lint
        command: pnpm lint
        timeout: 10m
      - name: test
        command: pnpm test
        timeout: 20m
      - name: build
        command: pnpm build
        timeout: 20m

tasks:
  dependency-maintenance:
    description: Review and safely update outdated dependencies.
    agent: maintenance
    promptFile: .gojo/tasks/dependency-maintenance.md
    validationProfile: standard
    concurrency:
      projectLimit: 1
      overlapPolicy: skip
    integration:
      mode: pull-request
      targetBranch: main
      requireAllValidations: true
    failurePolicy:
      maxAttemptsPerRun: 2
      disableAfterConsecutiveFailedRuns: 3
      backoff: exponential

schedules:
  weekly-dependencies:
    task: dependency-maintenance
    cron: "0 3 * * 1"
    timezone: America/Detroit

notifications:
  onSuccess:
    - engineering-slack
  onFailure:
    - engineering-slack
  onDisabled:
    - engineering-slack
```

Wire `engineering-slack` as a webhook/Slack channel on the instance (see [Notifications](/notifications)). Secrets stay out of the repo.

## Prompt file (the AI brief)

Create `.gojo/tasks/dependency-maintenance.md`:

```markdown
# Dependency maintenance

You are maintaining dependencies for this repository in an unattended gojo run.

## Goals
1. Identify outdated direct dependencies that are safe to upgrade.
2. Apply upgrades that do not require a major framework migration.
3. Fix compile/type errors caused by those upgrades.
4. Leave the repo in a state that passes lint, test, and build.

## Hard rules
- Do **not** push or merge to the default branch. gojo owns Git integration.
- Do **not** commit secrets, `.env` files, or credential material.
- Do **not** upgrade packages that require a multi-day migration; record them as deferred.
- Prefer the smallest change set that keeps the app healthy.
- Stay inside this worktree. Do not modify other projects or gojo’s own config.

## Process
1. Read `package.json` / lockfile (or language equivalent) and list outdated candidates.
2. Upgrade safe patch/minor releases first; group related packages when needed.
3. Run project scripts only as needed to diagnose failures; final validation is run by gojo.
4. Summarize every decision in the handoff.

## Required handoff
Write `.gojo/handoff.json` before you finish, including:
- summary of upgrades applied
- filesChanged
- decisions (especially skipped majors)
- unresolvedIssues
- recommendedNextActions
- agentAssessment.successful and confidence

Use schemaVersion 1. Set runId to a placeholder ULID if you do not know the platform id;
gojo will still associate the artifact with the real run.
```

Adjust package manager commands in `validationProfiles` to match the repo (`npm`, `yarn`, `cargo test`, `go test`, etc.).

## Why this is “advanced”

| Piece | vs first agent |
| --- | --- |
| Adapter | Claude Code / Cursor, not shell |
| Prompt | Multi-step safety brief + handoff contract |
| Validation | Full install → lint → test → build |
| Integration | `pull-request` on a shared branch |
| Concurrency | One maintenance run per project; skip overlaps |
| Schedule | Weekly cron with timezone |
| Failure policy | Retries + auto-disable after 3 failed weeks |
| Notifications | Success / failure / disabled routing |
| Repo sync | Fetch + require clean base before each run |

## Run it

1. Commit `gojo.yaml` and the prompt file.
2. **Sync** the project in gojo.
3. Confirm the agent shows installed under **Agents**.
4. Trigger once manually: `gojo task run <task-id>` (or Run in the UI).
5. Inspect the run: agent output, validation steps, PR link, handoff JSON.
6. Leave the schedule enabled once a manual run looks right.

## Failure modes to expect

- **Validation failed** — agent upgraded something that breaks tests; read the validation log, tighten the prompt, or pin the package.
- **Conflict** — `main` moved during the run; merge queue refuses unsafe auto-integration; retry or open a conflicted PR per policy.
- **Schedule disabled** — three consecutive failures; fix root cause, then re-enable explicitly.
- **Agent unavailable** — CLI missing/unauthenticated; `gojo agent detect` / `gojo server doctor`.

## Next

- [Advanced usage](/advanced-usage) — multi-agent roles, approval gates, secrets, budgets
- [Settings](/settings) — every knob used above
- [Concepts](/concepts) — why the platform owns merge and success
