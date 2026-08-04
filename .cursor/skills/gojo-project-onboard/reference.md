# gojo-project-onboard reference

Condensed contract for scaffolding. Source of truth: `packages/contracts/src/manifest.ts`, dogfood `gojo.yaml`, and `docs/agent-prompts.md` / site agent-prompts page.

## Vocabulary

- **Adapter** — installed CLI (shell / cursor / claude-code). Detected via `gojo adapter …`.
- **Profile** — entry under `profiles:` in the manifest; binds an adapter to a model/timeout/permissions.
- **Agent** — entry under `agents:` in the manifest; the durable work-unit definition. Picks a `profile` and points at a `promptFile` under `.gojo/agents/`.

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

profiles:
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
  # Prefer one canonical verify per surface, shared with CI:
  #   scripts/verify.sh / yarn verify / make verify
  #   then profile = that command + handoff-exists for PR agents.
  # Do not hand-enumerate lint/test/build per agent — they drift from CI.

agents: {}
schedules: {}
notifications: {}
```

Sync path: `gojo.yaml` then `.gojo/project.yaml`. Keys are durable identities; removing a key soft-disables the DB row.

## Required fields

| Object | Required |
| --- | --- |
| Agent (work unit) | `description`, `profile`, `promptFile`, `validationProfile` |
| Schedule | `agent`, `cron`, `timezone` |
| Profile | `adapter` (`shell` / `cursor` / `claude-code`) |
| Validation profile | `steps[]` with `name` + `command` (prefer the repo’s canonical verify script, same as CI) |

## Recommended agent defaults

```yaml
concurrency:
  projectLimit: 1
  overlapPolicy: skip
failurePolicy:
  maxAttemptsPerRun: 2
  disableAfterConsecutiveFailedRuns: 3
  backoff: exponential
```

AI PR agents:

```yaml
integration:
  mode: pull-request
  targetBranch: main
  prTool: gh
  requireAllValidations: true
selfHeal:
  agent: self-heal
  afterConsecutiveFailedRuns: 1
```

Shell ops / digests (no Git integration):

```yaml
# omit integration, or commit-only only when the agent truly owns commits
validationProfile: noop   # or a light smoke profile
```

When a shell/AI agent needs project secrets from a gitignored dotenv file (absent from run worktrees), declare an allowlist — never load the whole file into the daemon:

```yaml
environment:
  file: .env
  include:
    - EXAMPLE_API_URL
    - EXAMPLE_API_KEY
  required:
    - EXAMPLE_API_KEY
```

## Naming

- Agent/schedule keys: work identity only (`maintain-deps`, `fleet-digest`)
- Cadence only in `cron` / `timezone`
- One schedule per agent → **same key** for both

```yaml
agents:
  maintain-deps:
    description: Update dependencies; keep check green
    profile: cursor
    promptFile: .gojo/agents/maintain-deps.md
    validationProfile: full-check
schedules:
  maintain-deps:
    agent: maintain-deps
    cron: "0 2 * * 0"
    timezone: America/Detroit
```

## AI prompt skeleton

Write `.gojo/agents/<key>.md`:

```markdown
# <Agent title>

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
Write `.gojo/handoff.json` (prefer schemaVersion 3; 2 is fine for impact-only). Include `summary` (what / why / value),
`filesChanged`, `decisions`, `unresolvedIssues` / `recommendedNextActions`,
`agentAssessment`, `status`: `"completed"`. Prefer one `impact.items` entry per concrete subject using only the allowed categories (see gojo-handoff skill). Review agents need `subjectActions.verdict`.
```

Starting limits (tighten for riskier repos):

| Agent type | Start limit |
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
- Git ownership (gojo opens PRs from handoff; adapter does not run `gh pr create` / `tea pulls create`)
- Handoff judgment (what / why / value; `recommendedNextActions` at limit)

## Shell prompt skeleton

Shell adapter writes the prompt to `.gojo/run.sh` and runs `sh` on it. Put a **script body** in `promptFile` (instructions files are skipped):

```sh
set -eu
# evidence-backed command(s) from the target repo
make prs
make actions
```

Prefer existing Make/scripts over inventing new automation. Use a `noop` or light validation profile; set a short profile `timeout`.

## Register / sync

```bash
gojo project add <name> <abs-repo-path>
gojo project list
gojo project sync <id>
gojo agent list --project <id>
gojo schedule list
```

Manifest sync upserts by name and soft-disables missing keys. Schedules are created via sync, not REST create.

## Adapters

| Adapter | Prompt use |
| --- | --- |
| `cursor` / `claude-code` | Markdown prompt; gets `scheduledRunNotice` + `instructions.files` + `promptFile` |
| `shell` | Script body only; no instructions layer |

## Example agent ideas (evidence-driven)

**quotient-ecosystem:** `fleet-digest` (`make prs`/`actions`), fetch/state, monitor health, Crashlytics check — shell; no auto-promote.

**omni-actions:** gate via `make check`, env smoke scripts, App Engine version cleanup, DNS validate — skip in-app Nest crons (Salesforce/favicon).
