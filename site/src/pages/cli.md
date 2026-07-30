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

Two related concepts you'll see across commands:

- **Adapter** — the installed CLI (shell / cursor / claude-code). Managed by `gojo adapter …`.
- **Agent** — a work unit defined in `gojo.yaml`'s `agents:` map. Managed by `gojo agent …`.

## Setup & server

| Command | Purpose |
| --- | --- |
| `gojo setup --username … --password …` | Create the first admin |
| `gojo server start` | API + scheduler + web UI (foreground; blocks until Ctrl+C) |
| `gojo server start --daemon` | Same, but return immediately (process keeps running) |
| `gojo server status` | PID / health |
| `gojo server stop` | Stop via PID file |
| `gojo server doctor` | Git, disk, DB, adapter detection, daemon PATH tools |

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
| `gojo project work <id> [--kind …] [--provenance …] [--delivery …] [--attention …] [--history]` | Paged work ledger (first page; filters match API enums; `--history` includes completed/verified-terminal items) |
| `gojo project status <id>` | Canonical work counts (verified open, stale, attention, …) |
| `gojo project sources <id>` | Connected sources and sync health |
| `gojo project refresh-source <id> <sourceId>` | Reconcile one source immediately |
| `gojo project recheck-work <id> <workItemId>` | Verify one work item against its provider |
| `gojo project resolve-work <id> <workItemId> [--by …] [--note …]` | Operator-resolve attention without inventing delivery |

## Adapters (detection)

| Command | Purpose |
| --- | --- |
| `gojo adapter detect\|list\|inspect\|test` | Discover and probe installed agent CLIs |

## Agents & schedules

| Command | Purpose |
| --- | --- |
| `gojo agent list --project <id>\|inspect\|run\|enable\|disable\|cancel\|retry` | Inspect, run, and enable/disable (`list` requires `--project`; `inspect` returns read-only prompt/policy plus manifest `source` paths when synced) |
| `gojo schedule list\|enable\|disable\|pause\|next` | Timers |

## Runs

| Command | Purpose |
| --- | --- |
| `gojo run list [--project <id>]\|inspect\|logs\|diff\|artifacts` | Observe (`list` defaults to all projects; `artifacts` returns handoff, validation, and failure JSON) |
| `gojo integration list --open\|--merged\|--committed [--project <id>]` | List open, merged, or commit-only gojo-tracked integrations |
| `gojo run approve\|reject [--reason]` | Approve or reject runs in `await-approval` integration |

Failed runs may enqueue a project **self-heal** agent when the manifest declares `selfHeal` — see [Self-healing](/self-healing).

## Work status

| Command | Purpose |
| --- | --- |
| `gojo work-status rebuild [--project <id>] [--from <iso>]` | Rebuild hourly work-status rollup memoization |

## Backup

| Command | Purpose |
| --- | --- |
| `gojo backup create [dest]\|verify <archive>\|restore <archive>` | Instance disaster recovery (`create` picks a default dest when omitted) |

## Related

- [Getting started](/getting-started)
- [Settings](/settings)
- [FAQ](/faq)
- [Project visibility and sources](/project-visibility)
