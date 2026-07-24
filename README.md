# gojo

Self-hosted orchestration for coding agents — schedule the work, isolate the repo, prove the result, then integrate it. Agents propose; gojo owns success.

Works with **shell** scripts, **Cursor Agent**, and **Claude Code**. Ships a CLI and an embedded web UI (localhost by default). Data lives under `~/.gojo` (`GOJO_HOME` to override).

## Why gojo

- **Schedule with intent** — cron and one-offs, time zones, overlap policies, retries, auto-disable after repeated failures
- **Isolated Git worktrees** — every attempt gets its own branch so concurrent agents don’t collide
- **Validation you define** — install / lint / test / build run outside the agent conversation
- **Platform-owned integration** — commit-only, pull request, await approval, or auto-merge via a per-project merge queue
- **Operate locally** — SQLite on disk, encrypted secrets, backups, Slack/webhook notifications, systemd/launchd service

## Requirements

- Linux or macOS
- [Bun](https://bun.sh) 1.2+ (from source) **or** a compiled `gojo` binary
- Git
- A local Git repository to register as a project

Optional later: Cursor Agent or Claude Code CLIs on your `PATH`.

## Get started

```bash
git clone https://github.com/detroitpro/gojo.git
cd gojo
bun install

bun run gojo setup --username admin --password 'choose-a-strong-password'
bun run gojo server start
```

Open **http://127.0.0.1:7430**. Check readiness anytime:

```bash
bun run gojo server status
bun run gojo server doctor
```

`doctor` verifies Git, disk, the database, and which agent adapters are installed.

### Add a project

In the UI: **Projects → Browse… → Add project**. Or from the CLI:

```bash
bun run gojo project add demo /path/to/repo --branch main
bun run gojo project list
```

Registering a path is not enough — the repo needs a `gojo.yaml` (or `.gojo/project.yaml`). Sync loads tasks, agents, and schedules from that manifest.

### First task (shell)

In the **target repository** (not the gojo clone), add `gojo.yaml`:

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

And `.gojo/tasks/touch-note.sh`:

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

```bash
chmod +x .gojo/tasks/touch-note.sh
# commit gojo.yaml + the script in the target repo

bun run gojo project sync <project-id>
bun run gojo task run <task-id>
bun run gojo run list
```

Expect Preparing → Running → Validating → Integrating → **Succeeded**. With `commit-only`, changes land on a run branch without merging to `main`. The agent claiming success is not enough — validation and integration policy decide the outcome.

Prefer an agent to do the install? The docs landing page (`site/`, `#ask-your-agent`) has a copy-paste prompt that installs gojo, registers the current repo, and runs a first task.

## Background service

```bash
bun run gojo service install
bun run gojo service start
bun run gojo service logs
```

Linux uses `systemd`; macOS uses `launchd`.

## Common commands

```bash
bun run gojo setup --username admin --password 'secret'
bun run gojo server start
bun run gojo server doctor

bun run gojo project add demo /path/to/repo --branch main
bun run gojo project sync <project-id>
bun run gojo task run <task-id>

bun run gojo run list
bun run gojo schedule list
bun run gojo agent detect
```

Use `bun run gojo --help` for the full command tree. After `bun run build`, the same commands work as `./bin/gojo …`.

## Where data lives

Default `~/.gojo`:

| Path | Purpose |
|------|---------|
| `data/gojo.db` | projects, runs, schedules |
| `worktrees/` | isolated attempt workspaces |
| `artifacts/` | handoff reports and outputs |
| `secrets/` | encryption key for the secret store |
| `config/instance.yaml` | bind address, pause flag, telemetry |

## Documentation

Published docs: **https://detroitpro.github.io/gojo/** (GitHub Pages; deploys from `main` via Actions).

Source lives in [`site/`](./site/) (Astro, static — not served by the gojo daemon):

```bash
cd site && bun install && bun run dev   # http://localhost:4321/gojo
```

Guides cover getting started, first shell agent, Cursor/Claude workflows, schedules, notifications, settings, and CLI reference. Product intent and deeper design notes: [PRD.md](./PRD.md).

## Develop

```bash
bun run build          # compile bin/gojo for the current platform
bun run build:web      # Vue admin UI → web/dist (embedded by the server)
bun run check          # typecheck + tests
```

`GOJO_WEB_DIST` overrides where the server loads static admin assets from.

## Architecture

- **Runtime:** Bun + TypeScript (CLI, API, scheduler, adapters)
- **Persistence:** SQLite via `bun:sqlite`
- **Web UI:** Vue app in `web/`, embedded as static assets
- **Distribution:** `bun build --compile` native binaries; optional Node launcher in `packages/npx-bootstrap`
