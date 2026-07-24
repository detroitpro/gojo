---
layout: ../layouts/DocLayout.astro
title: Your first agent
description: Define a shell task in gojo.yaml, sync the project, and watch a successful run end-to-end.
---

The fastest way to learn gojo is a **shell** agent: a small script that edits the repo, then a validation command that proves it worked. No Cursor or Claude license required.

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

agents:
  shell:
    adapter: shell
    timeout: 5m

validationProfiles:
  quick:
    steps:
      - name: has-notes
        command: test -f NOTES.md
        timeout: 30s

tasks:
  touch-note:
    description: Create a NOTES.md file
    agent: shell
    promptFile: .gojo/tasks/touch-note.sh
    validationProfile: quick
    integration:
      mode: commit-only
      targetBranch: main
      requireAllValidations: true

schedules: {}
notifications: {}
```

## 2. Task script (the “agent”)

```bash
mkdir -p .gojo/tasks
```

Create `.gojo/tasks/touch-note.sh`:

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
  "resultCommit": null,
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

## 3. Sync and run

In the UI: **Projects → Sync**, then run the **touch-note** task.

From the CLI (after `project list` / `task list`):

```bash
bun run gojo project sync <project-id>
bun run gojo task run <task-id>
bun run gojo run list
```

Expect the run to move through Preparing → Running → Validating → Integrating → Succeeded. With `commit-only`, changes land on a `gojo/...` branch in the worktree/repo history without merging to `main`.

## 4. What “success” means here

1. The shell script exited successfully.
2. Validation `test -f NOTES.md` passed **in the worktree**.
3. gojo created a commit on the run branch (`commit-only`).

The agent claiming success is not enough — validation and integration policy decide the run outcome. See [Concepts](/concepts).

## Next: Cursor and Claude Code

Once the shell path works:

1. Install the **Cursor Agent** or **Claude Code** CLI and authenticate it on the host.
2. Check **Agents** in the UI (or `gojo agent detect`).
3. Add an agent profile in `gojo.yaml`:

```yaml
agents:
  maintenance:
    adapter: claude-code   # or: cursor
    model: default
    timeout: 45m
```

4. Point a task at that agent and put the natural-language instructions in `promptFile` (Markdown is fine).
5. Prefer **pull-request** or **await-approval** integration modes on shared repositories until you trust the task.

Adapters invoke the installed CLIs non-interactively and capture structured output when available. Unsupported or missing CLIs fail detection clearly instead of half-running.

## Optional: schedule it

```yaml
schedules:
  nightly-note:
    task: touch-note
    cron: "0 3 * * *"
    timezone: America/Detroit
```

Sync again, then confirm the next fire time under **Schedules**. Overlap, retries, and auto-disable are covered in [Settings](/settings).

## Ready for a real AI task?

When the shell path is green, move on to [Advanced agent](/advanced-agent): Claude Code or Cursor doing weekly dependency maintenance with full validation, pull requests, and handoffs. Broader patterns live in [Advanced usage](/advanced-usage).
