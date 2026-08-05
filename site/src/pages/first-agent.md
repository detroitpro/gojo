---
layout: ../layouts/DocLayout.astro
title: Your first agent
description: Define a shell agent in gojo.yaml, sync the project, and watch a successful run end-to-end.
---

The fastest way to learn gojo is a **shell** adapter: a small script that edits the repo, then a validation command that proves it worked. No Cursor or Claude license required.

The vocabulary you'll see in `gojo.yaml`:

- **`profiles:`** — reusable adapter configuration (shell / cursor / claude-code, timeout, model).
- **`agents:`** — the work units. Each agent picks a `profile` and points at a `promptFile`.
- **Adapters** (`gojo adapter detect` / UI tab) — the installed CLIs that back a profile.

## 1. Manifest in the repository

In the root of your Git project, create `gojo.yaml`:

```yaml
version: 1

project:
  name: demo
  defaultBranch: main

repository:
  remote: origin
  syncBeforeRun: false
  requireCleanBase: false
  submodules: false
  gitLfs: false

profiles:
  shell:
    adapter: shell
    timeout: 5m

validationProfiles:
  quick:
    steps:
      - name: has-notes
        command: test -f NOTES.md
        timeout: 30s

agents:
  touch-note:
    description: Create a NOTES.md file
    profile: shell
    promptFile: .gojo/agents/touch-note.sh
    validationProfile: quick
    integration:
      mode: commit-only
      targetBranch: main
      requireAllValidations: true

schedules: {}
notifications: {}
```

## 2. Agent script (the shell work unit)

```bash
mkdir -p .gojo/agents
```

Create `.gojo/agents/touch-note.sh`:

```bash
#!/bin/sh
set -eu
echo "hello from gojo" > NOTES.md

mkdir -p .gojo
cat > .gojo/handoff.json <<'JSON'
{
  "schemaVersion": 1,
  "runId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "status": "completed",
  "summary": "Created NOTES.md",
  "startingCommit": "unknown",
  "resultCommit": "unknown",
  "filesChanged": ["NOTES.md"],
  "validation": { "passed": true, "steps": [] },
  "decisions": [],
  "unresolvedIssues": [],
  "recommendedNextActions": [],
  "agentAssessment": { "successful": true, "confidence": 0.9 }
}
JSON
```

Commit the manifest and script to the repo.

> The shell adapter runs the prompt file as a script inside an isolated worktree. If `.gojo/handoff.json` exists afterward, gojo stores it as the structured handoff report. You can use a real ULID for `runId` in production; the platform also records its own run id.

### What to commit, and what to ignore

Your repo ends up with two kinds of gojo files:

| Commit these — registration | Ignore these — generated per run |
|---|---|
| `gojo.yaml` | `.gojo/handoff.json` |
| `.gojo/agents/**` | `.gojo/run.sh` |
| `.gojo/instructions.md` | `.gojo/assets/` |
| `.gojo/labels.md` | `.gojo/context/subject.json` (issue/PR-triggered runs only) |

Registration files are your configuration — a fresh clone should describe your agents completely. The generated files are per-run scratch that gojo also stores as run artifacts, so the copies in your repo are disposable.

gojo keeps generated files out of the commits it makes, so you do not have to get this right for agent pull requests to be clean. Add the ignore rules anyway to keep them out of your own `git status` and manual commits:

```gitignore
# gojo: ignore generated run files, keep registration files
.gojo/*
!.gojo/agents/
!.gojo/agents/**
!.gojo/instructions.md
!.gojo/labels.md
```

Ignoring everything and re-including the registration files means any generated file gojo adds later is ignored automatically. Run `gojo project doctor <project-id>` (or open the project's **Health** page in the admin UI) to see whether a repo follows this.

## 3. Sync and run

In the UI: **Projects → Sync**, then run the **touch-note** agent.

From the CLI (after `project list` / `agent list --project <id>`):

```bash
bun run gojo project sync <project-id>
bun run gojo agent run <agent-id>
bun run gojo run list
```

Expect the run to move through Preparing → Running → Validating → Integrating → Succeeded. With `commit-only`, changes land on a `gojo/...` branch in the worktree/repo history without merging to `main`.

## 4. What "success" means here

1. The shell script exited successfully.
2. Validation `test -f NOTES.md` passed **in the worktree**.
3. gojo created a commit on the run branch (`commit-only`).

The adapter claiming success is not enough — validation and integration policy decide the run outcome. See [Concepts](/concepts).

## Next: Cursor and Claude Code

Once the shell path works:

1. Install the **Cursor Agent** or **Claude Code** CLI and authenticate it on the host.
2. Check **Adapters** in the UI (or `gojo adapter detect`).
3. Add a profile in `gojo.yaml`:

```yaml
profiles:
  maintenance:
    adapter: claude-code   # or: cursor
    model: default
    timeout: 45m
```

4. Point an agent at that profile and put the natural-language instructions in `promptFile` (Markdown is fine).
5. Prefer **pull-request** integration on shared repositories until you trust the agent, or **await-approval** when the run should pause for explicit operator approval before integration continues (optional `postApprovalMode`; default `auto-merge`).

Adapters invoke the installed CLIs non-interactively and capture structured output when available. Unsupported or missing CLIs fail detection clearly instead of half-running.

## Optional: schedule it

```yaml
schedules:
  touch-note:
    agent: touch-note
    cron: "0 3 * * *"
    timezone: America/Detroit
```

Sync again, then confirm the next fire time under **Schedules**. Overlap, retries, and auto-disable are covered in [Settings](/settings).

## Ready for a real AI agent?

When the shell path is green, move on to [Advanced agent](/advanced-agent): Claude Code or Cursor doing weekly dependency maintenance with full validation, pull requests, and handoffs. Broader patterns live in [Advanced usage](/advanced-usage).
