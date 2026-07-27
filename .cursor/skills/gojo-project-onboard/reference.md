# gojo-project-onboard reference

Condensed contract for scaffolding. Source of truth: `src/shared/manifest.ts`, dogfood `gojo.yaml`, and `docs/task-prompts.md` / site task-prompts page.

## Manifest shape

```yaml
version: 1

project:
  name: <repo-name>
  defaultBranch: main

repository:
  remote: origin
  syncBeforeRun: true
  requireCleanBase: true
  submodules: false
  gitLfs: false

instructions:
  files:
    - .gojo/instructions.md
  scheduledRunNotice: |
    Unattended scheduled gojo run. Prefer small diffs. Write .gojo/handoff.json before exiting.

agents:
  shell:
    adapter: shell
    timeout: 5m
  cursor:
    adapter: cursor
    model: default
    timeout: 45m

validationProfiles:
  noop:
    steps:
      - name: noop
        command: "true"
        timeout: 30s
  # add repo-specific profiles (check, smoke, typecheck, …)

tasks: {}
schedules: {}
notifications: {}
```

Sync path: `gojo.yaml` then `.gojo/project.yaml`. Keys are durable identities; removing a key soft-disables the DB row.

## Required fields

| Object | Required |
| --- | --- |
| Task | `description`, `agent`, `promptFile`, `validationProfile` |
| Schedule | `task`, `cron`, `timezone` |
| Agent | `adapter` (`shell` / `cursor` / `claude`) |
| Validation profile | `steps[]` with `name` + `command` |

## Recommended task defaults

```yaml
concurrency:
  projectLimit: 1
  overlapPolicy: skip
failurePolicy:
  maxAttemptsPerRun: 2
  disableAfterConsecutiveFailedRuns: 3
  backoff: exponential
```

AI PR tasks:

```yaml
integration:
  mode: pull-request
  targetBranch: main
  prTool: gh
  requireAllValidations: true
selfHeal:
  task: self-heal
  afterConsecutiveFailedRuns: 1
```

Shell ops / digests (no Git integration):

```yaml
# omit integration, or commit-only only when the task truly owns commits
validationProfile: noop   # or a light smoke profile
```

## Naming

- Task/schedule keys: work identity only (`maintain-deps`, `fleet-digest`)
- Cadence only in `cron` / `timezone`
- One schedule per task → **same key** for both

```yaml
tasks:
  maintain-deps:
    description: Update dependencies; keep check green
    agent: cursor
    promptFile: .gojo/tasks/maintain-deps.md
    validationProfile: full-check
schedules:
  maintain-deps:
    task: maintain-deps
    cron: "0 2 * * 0"
    timezone: America/Detroit
```

## AI prompt skeleton

Write `.gojo/tasks/<key>.md`:

```markdown
# <Task title>

## Goals
1. …
2. …

## Scope
- In: …
- Out: …

## How you think
- (optional) 2–4 role-specific heuristics only

## Hard rules
- Do **not** push, open PRs, or merge. gojo owns Git integration.
- Do **not** weaken CI or commit secrets.
- **Limit:** <N> <units> per run.
- If more work remains, stop and list it in `recommendedNextActions`.

## Process
1. …
2. …

## Required handoff
Write `.gojo/handoff.json` (schemaVersion 2). Include `summary` (what / why / value),
`filesChanged`, `decisions`, `unresolvedIssues` / `recommendedNextActions`,
`agentAssessment`, `status`: `"completed"`. Prefer one `impact.items` entry per concrete subject.
```

Starting limits (tighten for riskier repos):

| Task type | Start limit |
| --- | --- |
| Tests / coverage | ≤5 new test cases |
| Refactors / quality | one theme; ≤8 source files |
| Dependencies | ≤8 direct bumps; ≤2 majors |
| Docs | ≤5 files; ≤1 new page |
| Self-heal | one root cause; ≤5 files |

## Shared instructions skeleton

Write `.gojo/instructions.md` for AI agents (shell skips this layer):

- Code qualities (minimal, boundary-honest, reviewable)
- Operating defaults (no features for niceness, no secrets, stay in worktree)
- Git ownership (gojo opens PRs from handoff; agent does not run `gh pr create` / `tea pulls create`)
- Handoff judgment (what / why / value; `recommendedNextActions` at limit)

## Shell prompt skeleton

Shell adapter writes the prompt to `.gojo/run.sh` and runs `sh` on it. Put a **script body** in `promptFile` (instructions files are skipped):

```sh
set -eu
# evidence-backed command(s) from the target repo
make prs
make actions
```

Prefer existing Make/scripts over inventing new automation. Use a `noop` or light validation profile; set a short agent `timeout`.

## Register / sync

```bash
gojo project add <name> <abs-repo-path>
gojo project list
gojo project sync <id>
gojo task list
gojo schedule list
```

Manifest sync upserts by name and soft-disables missing keys. Schedules are created via sync, not REST create.

## Adapters

| Adapter | Prompt use |
| --- | --- |
| `cursor` / `claude` | Markdown prompt; gets `scheduledRunNotice` + `instructions.files` + `promptFile` |
| `shell` | Script body only; no instructions layer |

## Example task ideas (evidence-driven)

**quotient-ecosystem:** `fleet-digest` (`make prs`/`actions`), fetch/state, monitor health, Crashlytics check — shell; no auto-promote.

**omni-actions:** gate via `make check`, env smoke scripts, App Engine version cleanup, DNS validate — skip in-app Nest crons (Salesforce/favicon).
