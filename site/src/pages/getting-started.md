---
layout: ../layouts/DocLayout.astro
title: Getting started
description: Install gojo, create an admin account, add your first Git project, and run a task.
---

Prefer an agent? Use the install prompt on the [home page](/#ask-your-agent). Source: [github.com/detroitpro/gojo](https://github.com/detroitpro/gojo).

## What you’ll need

- Linux or macOS
- [Bun](https://bun.sh) 1.2+ (for running from source), **or** a compiled `gojo` binary
- Git
- A local Git repository you can point gojo at

Optional later: Cursor Agent or Claude Code CLIs on your `PATH`.

## Install from source

```bash
git clone https://github.com/detroitpro/gojo.git
cd gojo
bun install
bun run install:cli
```

`install:cli` compiles gojo and copies it to **`~/.local/bin/gojo`** (no sudo), plus the admin UI into `~/.gojo/web/dist`. For a system-wide binary:

```bash
bun run install:cli -- --system
```

That installs to `/usr/local/bin/gojo` (may prompt for sudo).

If `~/.local/bin` is missing from your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

After that you can type `gojo` from any directory. To run from the checkout without installing, use `bun run gojo …` instead.

## Create your admin account

```bash
gojo setup --username admin --password 'choose-a-strong-password'
```

This creates the first user. After setup, mutating API and UI actions require login or an API token.

## Start the server

```bash
gojo server start
```

Open **http://127.0.0.1:7430** (default). The server binds to localhost unless you change instance settings.

Useful checks:

```bash
gojo server status
gojo server doctor
```

`doctor` verifies Git, disk, the database, agent adapters, and whether tools like `bun` / `gh` resolve under the daemon's PATH. Project doctor also reports a dirty primary checkout and missing validation binaries.

## Add a project

1. Open **Projects** in the web UI.
2. Enter a short name (or leave it blank and let Browse fill it).
3. Click **Browse…** and pick the repository folder on the host machine.
4. Click **Add project**.

You can also do this from the CLI:

```bash
gojo project add demo /path/to/repo --branch main
gojo project list
```

## After you add a project

Adding a project only registers the repo path. Next:

1. **Add a `gojo.yaml`** (or `.gojo/project.yaml`) in the repository if you don’t have one yet — see [Your first agent](/first-agent).
2. Click **Sync** (or `gojo project sync <project-id>`) so gojo loads tasks, agents, and schedules from the manifest.
3. Open **Agents** and confirm at least **shell** is installed (always available).
4. Run a task from **Tasks** / CLI, or wait for a schedule to fire.
5. Watch the run under **Runs** — live state, logs, and handoff when it finishes.

If Sync finds no manifest, you’ll have zero tasks until you create one in the repo or via the API/CLI.

## Run as a background service

Prefer `bun run install:cli` first so the service unit can point at the compiled binary.

```bash
gojo service install
gojo service start
```

Linux uses `systemd`; macOS uses `launchd`. The unit embeds your install-time `PATH` (so validation can find `bun` under a non-login service). Re-run `gojo service install` after changing tool locations. Logs: `gojo service logs`.

## Where data lives

By default everything is under `~/.gojo` (override with `GOJO_HOME`):

- `data/gojo.db` — projects, runs, schedules
- `worktrees/` — isolated attempt workspaces
- `artifacts/` — handoff reports and outputs
- `secrets/` — encryption key for the secret store
- `config/instance.yaml` — bind address, pause flag, telemetry

## Next steps

- [Your first agent](/first-agent) — a complete shell task example
- [Advanced agent](/advanced-agent) — AI coding agent with PRs and schedules
- [Advanced usage](/advanced-usage) — multi-role agents, approvals, secrets
- [Documentation](/docs) — settings, concepts, CLI, FAQ
