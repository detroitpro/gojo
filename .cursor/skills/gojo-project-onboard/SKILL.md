---
name: gojo-project-onboard
description: >-
  Analyzes a target repository and generates a gojo task/schedule catalog, then
  scaffolds gojo.yaml and .gojo/ prompt files after confirmation. Use when
  onboarding a project to gojo, registering a repo, generating tasks, creating
  gojo.yaml, or when the user asks to analyze a project for gojo schedules
  (e.g. quotient-ecosystem, omni-actions).
---

# gojo project onboard

Turn an external repo into a syncable gojo project: analyze → propose → confirm → scaffold. Register/sync with the daemon only when the user asks.

Manifest contract and prompt skeletons: [reference.md](reference.md). Dogfood examples live in this repo’s `gojo.yaml` and `.gojo/`.

## Preconditions

- Target is a git repo path the user names (absolute or relative).
- Do **not** write files until the user confirms the proposed catalog (or an edited subset).
- Do **not** run `gojo project add` / `gojo project sync` unless the user explicitly asks.
- Prefer reading README / Makefile / CI / existing crons over inventing work.

## Workflow

Copy and track:

```
Onboard:
- [ ] 1. Analyze (read-only)
- [ ] 2. Propose catalog (no writes)
- [ ] 3. Confirm / edit with user
- [ ] 4. Scaffold gojo.yaml + .gojo/
- [ ] 5. Register + sync (only if asked)
```

### 1. Analyze (read-only)

Inspect the target repo:

- Purpose / stack — README, `PROJECT.md`, package managers, language roots
- Entrypoints — `make` help/targets, npm/bun scripts, CI workflows, `scripts/`
- Existing automation — in-app crons, systemd timers, GitHub Actions → **do not duplicate**
- Validation candidates — `make check`, typecheck/test, smoke scripts
- Defaults — default branch, remote name, PR host (`gh` vs `tea`)
- Risk — secrets, deploy/promote, destructive ops → omit or shell-only with explicit user OK

### 2. Propose (no writes)

Present a short catalog (typically **3–7** tasks). Prefer evidence-backed rows over a full palette dump.

| key | kind | description | cadence | validation | integration | why |
| --- | --- | --- | --- | --- | --- | --- |
| `fleet-digest` | shell | … | `0 8 * * *` / America/Detroit | noop or light | none | `make prs` exists |

Columns:

- **key** — durable id; **no cadence** in the name (`maintain-deps`, not `maintain-deps-weekly`)
- **kind** — `ai` (cursor/claude) or `shell`
- **cadence** — proposed `cron` + timezone only (not part of the key)
- **integration** — `pull-request` / `commit-only` / none
- **why** — one sentence citing repo evidence

Palette to consider (pick only what fits):

- AI `maintain-*` (quality / tests / deps / docs) when a clear check gate exists
- `self-heal` when AI PR tasks exist
- `activity-digest` when a notification channel exists — AI, report-only, `validationProfile: handoff`, task-level `notifications`, no `integration`. Copy the executive-brief prompt from [`.gojo/tasks/activity-digest.md`](../../../.gojo/tasks/activity-digest.md); every fleet repo uses the same shape with its own repo slug and forge CLI.
- Shell ops for smoke and hygiene — **not** auto-deploy / auto-promote
- Prefer **schedule key = task key**

Ask which rows to keep and any edits (cadence, agent, target branch).

### 3. Scaffold (on confirm)

Write into the **target** repo (not gojo unless gojo is the target):

| Path | Purpose |
| --- | --- |
| `gojo.yaml` | Manifest: project, agents, profiles, tasks, schedules |
| `.gojo/instructions.md` | Shared AI qualities + handoff judgment |
| `.gojo/tasks/<key>.md` | Per-task prompt (AI markdown or shell script body) |

Rules:

- Required task fields: `description`, `agent`, `promptFile`, `validationProfile`
- Required schedule fields: `task`, `cron`, `timezone`
- AI prompts: Role / Goals / Scope / Hard rules (**numeric limits**) / Process / Required handoff
- Shell prompts: executable script body (shell adapter runs `sh` on the inlined prompt)
- Defaults: `concurrency.projectLimit: 1`, `overlapPolicy: skip`, failurePolicy with disable-after-N, timezone `America/Detroit` unless the repo signals otherwise
- If `gojo.yaml` / `.gojo/` already exist: **merge**; never drop unknown tasks/schedules without asking

Field tables and templates: [reference.md](reference.md).

### 4. Register (opt-in)

Only when asked:

```bash
gojo project add <name> <abs-repo-path>
gojo project sync <id>
```

Report project id and synced task/schedule names. Do not enable/disable schedules or fire runs unless asked.

## Example anchors

**quotient-ecosystem** (meta/fleet): shell-heavy — fleet digest (`make prs` / `make actions`), fetch/state, monitor health, Crashlytics check. Avoid auto-promote.

**omni-actions** (Nest + Vite on GCP): `make check`, env smoke, App Engine version cleanup, DNS validate. Skip Nest Salesforce/favicon crons already in-app.

## Do not

- Scaffold before confirmation
- Encode cadence in task/schedule keys
- Duplicate existing automation
- Auto-deploy, auto-promote, or other destructive schedules without explicit user request
- Push, open PRs, or start runs as part of onboarding
