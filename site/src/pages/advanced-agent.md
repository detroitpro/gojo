---
layout: ../layouts/DocLayout.astro
title: Advanced agent
description: A production-shaped AI coding agent — dependency maintenance with Claude Code or Cursor, real validation, pull requests, schedules, and handoffs.
---

The [first agent](/first-agent) proves the pipeline with a shell script. This page shows a **real AI coding agent**: review outdated dependencies, apply safe upgrades, run your test suite, and open a pull request — on a weekly schedule.

You need the **Claude Code** or **Cursor Agent** CLI installed and authenticated on the gojo host (`gojo adapter detect`).

## What this agent does

1. Starts from an isolated worktree and branch.
2. Receives a detailed prompt (repo context, safety rules, handoff requirements).
3. Uses the coding-agent adapter to inspect and upgrade dependencies.
4. gojo runs **your** lint/test/build validation — not the adapter's self-report.
5. Opens a **pull request** (or waits for approval) instead of merging to `main`.
6. Writes a structured handoff so next week's run (or a human) knows what was deferred.

## Manifest sketch

Add (or merge) into `gojo.yaml`. The modeline on line 1 associates the file with
the [published JSON Schema](https://raw.githubusercontent.com/detroitpro/gojo/main/packages/contracts/schemas/gojo.project.schema.json)
(see [Settings](/settings)).

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/detroitpro/gojo/main/packages/contracts/schemas/gojo.project.schema.json
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
    You are executing an unattended scheduled agent.
    A future agent may inspect and continue this work.
    Produce a complete structured handoff report at .gojo/handoff.json.

profiles:
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

agents:
  dependency-maintenance:
    description: Review and safely update outdated dependencies.
    profile: maintenance
    promptFile: .gojo/agents/dependency-maintenance.md
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
  dependency-maintenance:
    agent: dependency-maintenance
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

Create `.gojo/agents/dependency-maintenance.md`:

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
- **Limit:** bump at most **8** direct dependencies and at most **2** majors per run.
- Prefer the smallest change set that keeps the app healthy.
- Stay inside this worktree. Do not modify other projects or gojo's own config.
- If more packages need upgrades, stop at the limit once CI is green and list them in `recommendedNextActions`.

## Process
1. Read `package.json` / lockfile (or language equivalent) and list outdated candidates.
2. Upgrade safe patch/minor releases first; group related packages when needed.
3. Run project scripts only as needed to diagnose failures; final validation is run by gojo.
4. Summarize every decision in the handoff.

## Required handoff
Write `.gojo/handoff.json` before you finish. **gojo opens the PR from this handoff**
(title ≈ first line of summary; body from summary/decisions/files). Do **not** run \`gh pr create\`.

Include:
- summary — first line is the PR title; cover **what** changed, **why**, and the **value**
- filesChanged
- decisions (especially skipped majors, with rationale)
- unresolvedIssues
- recommendedNextActions
- agentAssessment.successful and confidence

Use schemaVersion 3. Set runId to a placeholder ULID if you do not know the platform id;
gojo will still associate the artifact with the real run.

Also report impact — one \`impact.items\` entry per upgraded package
(category \`dependency-update\`, subject = package name, evidence.files =
manifest/lockfile). Never report totals; unverifiable claims are shown as
"claimed" on the dashboard.
```

Adjust package manager commands in `validationProfiles` to match the repo (`npm`, `yarn`, `cargo test`, `go test`, etc.).

**Start every new agent with constrained limits** in Hard rules (tests, files, packages, PRs). Widen later once the schedule is trusted — see [Agent prompt best practices](/agent-prompts). That guide also covers **handoff → PR description**.

## Why this is "advanced"

| Piece | vs first agent |
| --- | --- |
| Profile | Claude Code / Cursor, not shell |
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
3. Confirm the adapter shows installed under **Adapters**.
4. Trigger once manually: `gojo agent run <agent-id>` (or Run in the UI).
5. Inspect the run: adapter output, validation steps, PR link, handoff JSON.
6. Leave the schedule enabled once a manual run looks right.

## Failure modes to expect

- **Validation failed** — adapter upgraded something that breaks tests; read the validation log, tighten the prompt, or pin the package.
- **Conflict** — `main` moved during the run; merge queue refuses unsafe auto-integration; retry or open a conflicted PR per policy.
- **Schedule disabled** — three consecutive failures; fix root cause, then re-enable explicitly.
- **Adapter unavailable** — CLI missing/unauthenticated; `gojo adapter detect` / `gojo server doctor`.

## Next

- [Agent prompt best practices](/agent-prompts) — constrained limits, hard rules, handoffs
- [Advanced usage](/advanced-usage) — multi-profile roles, approval gates, secrets, budgets
- [Settings](/settings) — every knob used above
- [Concepts](/concepts) — why the platform owns merge and success
