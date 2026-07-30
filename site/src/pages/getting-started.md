---
layout: ../layouts/DocLayout.astro
title: Getting started
description: Install gojo, create an admin account, add your first Git project, and run an agent.
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

On a terminal you can also run `gojo setup` with no flags and enter the username and password interactively.

**Setup is create-once.** It creates the first admin and then refuses forever — it does not change an existing password and does not create a second user. To change the password later:

```bash
gojo auth password
```

Or use **Settings → Account** in the UI after signing in. After setup, mutating API and UI actions require login or an API token.

## Start the server

```bash
gojo server start
```

Open **http://127.0.0.1:7430** (default). The server binds to localhost unless you change instance settings.

![gojo dashboard after login](/images/ui-dashboard.png)

Useful checks:

```bash
gojo server status
gojo server doctor
```

`doctor` verifies Git, disk, the database, adapter detection, and whether tools like `bun` / `gh` resolve under the daemon's PATH. Project doctor also reports a dirty primary checkout and missing validation binaries.

## Add a project

1. Open **Projects** in the web UI.
2. Click **Add project** in the page header.
3. Enter a short name (or leave it blank and let Browse fill it).
4. Click **Browse** and pick the repository folder on the host machine.
5. Confirm **Add project** in the dialog.

![gojo projects view](/images/ui-projects.png)

You can also do this from the CLI:

```bash
gojo project add demo /path/to/repo --branch main
gojo project list
```

## After you add a project

Adding a project only registers the repo path. Next:

1. **Add a `gojo.yaml`** (or `.gojo/project.yaml`) in the repository if you don't have one yet — see [Your first agent](/first-agent).
2. Click **Sync** on the list or project detail (or `gojo project sync <project-id>`). Sync reads the manifest and upserts profiles, agents, and schedules by name; removed entries are soft-disabled. It does not change git.
3. **Open** the project to see health (path, manifest, dirty checkout, ignored gojo run files, validation tools) and a structured config view.
4. Open **Adapters** and confirm at least **shell** is installed (always available).
5. Run an agent from **Agents** / CLI, or wait for a schedule to fire.
6. Watch the run under **Runs** — live state, logs, and handoff when it finishes.

If Sync finds no manifest, you'll have zero agents until you create one in the repo or via the API/CLI. **Remove** only unregisters the project from gojo; your git checkout stays on disk.

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
- `config/instance.yaml` — bind address, publicBaseUrl, trusted proxies, pause, telemetry

Remote access (Cloudflare TLS edge): configure **Settings → Network** or
`gojo instance set --public-base-url https://… --trusted-proxies cloudflare,127.0.0.1`,
then restart. Details: [Settings](/settings), [FAQ](/faq).

## Next steps

- [Your first agent](/first-agent) — a complete shell agent example
- [Advanced agent](/advanced-agent) — AI coding agent with PRs and schedules
- [Advanced usage](/advanced-usage) — multi-role agents, approvals, secrets
- [Documentation](/docs) — settings, concepts, CLI, FAQ
