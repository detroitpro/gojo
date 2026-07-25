---
layout: ../layouts/DocLayout.astro
title: CLI reference
description: Consumer-friendly map of gojo commands. Use --output json for scripting.
---

Global flags:

```bash
gojo --home <path> --output text|json|yaml <command>
```

Install the CLI onto your `PATH` from a source checkout with `bun run install:cli` (copies to `~/.local/bin/gojo`; use `-- --system` for `/usr/local/bin`). Until then, from the checkout you can prefix with `bun run` (for example `bun run gojo server start`).

## Setup & server

| Command | Purpose |
| --- | --- |
| `gojo setup --username … --password …` | Create the first admin |
| `gojo server start` | API + scheduler + web UI (foreground; add `--daemon` to detach) |
| `gojo server status` | PID / health |
| `gojo server stop` | Stop via PID file |
| `gojo server doctor` | Git, disk, DB, agent detection, daemon PATH tools |

## Service

| Command | Purpose |
| --- | --- |
| `gojo service install` | systemd / launchd unit (ExecStart + PATH for this binary) |
| `gojo service start\|stop\|restart\|status\|logs` | Lifecycle |
| `gojo service uninstall` | Remove unit |

## Projects

| Command | Purpose |
| --- | --- |
| `gojo project add <name> <repoPath> [--branch] [--remote]` | Register a repo |
| `gojo project list\|inspect\|sync\|doctor\|remove` | Manage projects |

## Agents

| Command | Purpose |
| --- | --- |
| `gojo agent detect\|list\|inspect\|test` | Discover and probe adapters |

## Tasks & schedules

| Command | Purpose |
| --- | --- |
| `gojo task list --project <id>\|run\|cancel\|retry` | Manual execution (`list` requires `--project`) |
| `gojo schedule list\|enable\|disable\|pause\|next` | Timers |

## Runs

| Command | Purpose |
| --- | --- |
| `gojo run list [--project <id>]\|inspect\|logs\|diff` | Observe (`list` is all runs without `--project`) |
| `gojo run approve\|reject\|artifacts` | Govern (artifacts include `handoff.json`, `validation.json`, `failure.json`) |

Failed runs may enqueue a project **self-heal** task when the manifest declares `selfHeal` — see [Self-healing](/self-healing).

## Backup

| Command | Purpose |
| --- | --- |
| `gojo backup create\|verify\|restore` | Instance disaster recovery |

## Related

- [Getting started](/getting-started)
- [Settings](/settings)
- [FAQ](/faq)
