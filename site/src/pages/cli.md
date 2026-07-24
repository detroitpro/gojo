---
layout: ../layouts/DocLayout.astro
title: CLI reference
description: Consumer-friendly map of gojo commands. Use --output json for scripting.
---

Global flags:

```bash
gojo --home <path> --output text|json|yaml <command>
```

From a source checkout, prefix with `bun run` (for example `bun run gojo server start`).

## Setup & server

| Command | Purpose |
| --- | --- |
| `gojo setup --username … --password …` | Create the first admin |
| `gojo server start` | API + scheduler + web UI |
| `gojo server status` | PID / health |
| `gojo server stop` | Stop via PID file |
| `gojo server doctor` | Git, disk, DB, agent detection |

## Service

| Command | Purpose |
| --- | --- |
| `gojo service install` | systemd / launchd unit |
| `gojo service start\|stop\|restart\|logs` | Lifecycle |
| `gojo service uninstall` | Remove unit |

## Projects

| Command | Purpose |
| --- | --- |
| `gojo project add <name> <repoPath> [--branch]` | Register a repo |
| `gojo project list\|inspect\|sync\|doctor\|remove` | Manage projects |

## Agents

| Command | Purpose |
| --- | --- |
| `gojo agent detect\|list\|inspect\|test` | Discover and probe adapters |

## Tasks & schedules

| Command | Purpose |
| --- | --- |
| `gojo task list\|run\|cancel\|retry` | Manual execution |
| `gojo schedule list\|enable\|disable\|pause\|next` | Timers |

## Runs

| Command | Purpose |
| --- | --- |
| `gojo run list\|inspect\|logs\|diff` | Observe |
| `gojo run approve\|reject\|artifacts` | Govern |

## Backup

| Command | Purpose |
| --- | --- |
| `gojo backup create\|verify\|restore` | Instance disaster recovery |

## Related

- [Getting started](/getting-started)
- [Settings](/settings)
- [FAQ](/faq)
