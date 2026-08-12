---
name: gojo-project-onboard
description: >-
  Enable an existing Git repo as a gojo project: analyze the repo, propose
  agents/schedules, scaffold gojo.yaml + .gojo/ prompts (schema-valid), then
  register/sync/enable with the daemon when asked. Use when onboarding or
  enabling a project on gojo, generating gojo.yaml, registering a repo, or
  when the user asks to analyze a project for gojo schedules.
---

# gojo project onboard

Turn an **existing** Git repo into a syncable, enabled gojo project:

**analyze → propose → confirm → scaffold → register/sync/enable (when asked).**

User-facing install + first-agent docs:
[Getting started](https://detroitpro.github.io/gojo/getting-started),
[Your first agent](https://detroitpro.github.io/gojo/first-agent),
homepage [Ask your agent](https://detroitpro.github.io/gojo/#ask-your-agent).

Manifest contract / prompt skeletons: [reference.md](reference.md). Dogfood:
this repo’s `gojo.yaml` and `.gojo/`.

## Schema (required)

Every scaffolded `gojo.yaml` **must** start with the yaml-language-server modeline
and validate against the published JSON Schema (same contract Sync uses):

- **Schema (raw, editors):** https://raw.githubusercontent.com/detroitpro/gojo/main/packages/contracts/schemas/gojo.project.schema.json
- **Schema (docs site copy):** https://detroitpro.github.io/gojo/schemas/gojo.project.schema.json
- **How to associate:** [Settings → Editor autocomplete](https://detroitpro.github.io/gojo/settings) · maintainer note [`docs/manifest-json-schema.md`](../../../docs/manifest-json-schema.md)

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/detroitpro/gojo/main/packages/contracts/schemas/gojo.project.schema.json
version: 1
```

Do **not** invent fields absent from the schema (`additionalProperties: false`).
Common mistake: `integration.commitMessage` is **not** a manifest field — gojo
builds commit/PR titles at run time.

## Vocabulary

- **`profiles:`** — reusable adapter configuration (shell / cursor / claude-code + timeout + model).
- **`agents:`** — the work-unit definitions. Each agent picks a profile and points at a `promptFile`.
- **`.gojo/agents/`** — prompt files for the work units.
- **CLI:** `gojo agent …` for work units; `gojo adapter …` for detecting installed coding-agent CLIs.
- **Enable** — project/agent/schedule `enabled` (manifest or `gojo project|agent|schedule enable <id>`). Sync reapplies YAML `enabled` flags.

## Preconditions

- Target is a git repo path the user names (absolute or relative), **or** the current workspace when they say “enable this project.”
- Do **not** write files until the user confirms the proposed catalog (or an edited subset).
- Do **not** run `gojo project add` / `sync` / `enable` / agent runs unless the user explicitly asks to enable / register / run.
- Prefer reading README / Makefile / CI / existing crons over inventing work.
- If gojo is not installed on the host and the user wants full enablement, follow the install path in [Getting started](https://detroitpro.github.io/gojo/getting-started) (or the homepage agent prompt) **before** register/sync.

## Workflow

Copy and track:

```
Onboard / enable:
- [ ] 1. Analyze (read-only)
- [ ] 2. Propose catalog (no writes)
- [ ] 3. Confirm / edit with user
- [ ] 4. Scaffold gojo.yaml + .gojo/ (schema modeline + valid fields only)
- [ ] 5. Register + sync + enable (only if asked)
```

### 1. Analyze (read-only)

Inspect the target repo:

- Purpose / stack — README, `PROJECT.md`, package managers, language roots
- Entrypoints — `make` help/targets, npm/bun scripts, CI workflows, `scripts/`
- Existing automation — in-app crons, systemd timers, GitHub Actions → **do not duplicate**
- Validation candidates — `make check`, typecheck/test, smoke scripts
- Defaults — default branch, remote name, PR host (`gh` vs `tea`)
- Risk — secrets, deploy/promote, destructive ops → omit or shell-only with explicit user OK
- Existing gojo — if `gojo.yaml` / `.gojo/` already exist, plan a **merge**, not a replace

### 2. Propose (no writes)

Present a short catalog (typically **3–7** agents). Prefer evidence-backed rows over a full palette dump.

| key | kind | description | cadence | validation | integration | why |
| --- | --- | --- | --- | --- | --- | --- |
| `fleet-digest` | shell | … | `0 8 * * *` / America/Detroit | noop or light | none | `make prs` exists |

Columns:

- **key** — durable id; **no cadence** in the name (`maintain-deps`, not `maintain-deps-weekly`)
- **kind** — `ai` (cursor/claude) or `shell`
- **cadence** — proposed `cron` + timezone only (not part of the key)
- **integration** — `pull-request` / `commit-only` / omit
- **why** — one sentence citing repo evidence

Palette to consider (pick only what fits):

- AI `maintain-*` (quality / tests / deps / docs) when a clear check gate exists
- `self-heal` when AI PR agents exist
- `activity-digest` when a notification channel exists — AI, report-only, `validationProfile: handoff`, agent-level `notifications`, no `integration`. Copy the executive-brief prompt from [`.gojo/agents/activity-digest.md`](../../../.gojo/agents/activity-digest.md); every fleet repo uses the same shape with its own repo slug and forge CLI.
- Shell ops for smoke and hygiene — **not** auto-deploy / auto-promote
- Prefer **schedule key = agent key**
- First-time enable: a small shell `repo-brief` (or touch-note) agent is fine if the user wants a smoke run before AI agents — see [Your first agent](https://detroitpro.github.io/gojo/first-agent)

Ask which rows to keep and any edits (cadence, profile, target branch).

### 3. Scaffold (on confirm)

Write into the **target** repo (not gojo unless gojo is the target):

| Path | Purpose |
| --- | --- |
| `gojo.yaml` | Manifest: project, profiles, agents, schedules — **with schema modeline** |
| `.gojo/instructions.md` | Shared AI qualities + handoff judgment |
| `.gojo/agents/<key>.md` | Per-agent prompt (AI markdown or shell script body) |
| `.gitignore` rules | Ignore generated `.gojo/*` run files; keep agents/instructions/labels |

Rules:

- Line 1: `# yaml-language-server: $schema=https://raw.githubusercontent.com/detroitpro/gojo/main/packages/contracts/schemas/gojo.project.schema.json`
- Required agent fields: `description`, `profile`, `promptFile`, `validationProfile`
- Required schedule fields: `agent`, `cron`, `timezone`
- Required profile fields: `adapter` (`shell` / `cursor` / `claude-code`)
- `integration` when present: only schema fields (`mode`, `targetBranch`, optional `requireAllValidations`, `prTool`, …) — **no `commitMessage`**
- AI prompts: Role / Goals / Scope / Hard rules (**numeric limits**) / Process / Required handoff
- Shell prompts: executable script body (shell adapter runs `sh` on the inlined prompt)
- Defaults: `concurrency.projectLimit: 1`, `overlapPolicy: skip`, failurePolicy with disable-after-N, timezone `America/Detroit` unless the repo signals otherwise
- If `gojo.yaml` / `.gojo/` already exist: **merge**; never drop unknown agents/schedules without asking

Field tables and templates: [reference.md](reference.md).

### 4. Register / sync / enable (opt-in)

Only when the user asks to enable, register, sync, or run:

```bash
# Instance must already be set up (gojo setup + server/service running).
gojo project add <name> <abs-repo-path> --branch <default-branch>
gojo project list
gojo project sync <project-id>
gojo project enable <project-id>   # if previously disabled; Sync also applies YAML enabled flags
gojo agent list --project <project-id>
gojo schedule list --project <project-id>
gojo project doctor <project-id>
```

Optional smoke run (only if asked):

```bash
gojo agent run <agent-id>
gojo run list --project <project-id>
```

Report project id, synced agent/schedule names, and enablement state. Do not open PRs, push, or fire schedules unless asked.

## Example anchors

**quotient-ecosystem** (meta/fleet): shell-heavy — fleet digest (`make prs` / `make actions`), fetch/state, monitor health, Crashlytics check. Avoid auto-promote.

**omni-actions** (Nest + Vite on GCP): `make check`, env smoke, App Engine version cleanup, DNS validate. Skip Nest Salesforce/favicon crons already in-app.

## Do not

- Scaffold before confirmation
- Encode cadence in agent/schedule keys
- Duplicate existing automation
- Invent non-schema YAML fields (including `integration.commitMessage`)
- Auto-deploy, auto-promote, or other destructive schedules without explicit user request
- Push, open PRs, or start runs as part of onboarding unless the user asked to enable/run
