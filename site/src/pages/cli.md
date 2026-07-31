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

## Help

```bash
gojo --help
gojo auth --help
gojo auth password --help
```

Text mode is colorful on a TTY (`NO_COLOR=1` to disable). Use `--output json` or `--output yaml` for scripts — those stay machine-pure.

Exit codes: `0` ok · `1` usage · `2` not found · `3` conflict (e.g. setup already done) · `4` auth failure.

## Setup, auth & server

| Command | Purpose |
| --- | --- |
| `gojo setup` | Create the **first** admin (interactive on TTY, or `--username` / `--password`) |
| `gojo auth whoami` | Show local users |
| `gojo auth password` | Change the admin password (local DB; daemon optional) |
| `gojo server start` | API + scheduler + web UI (foreground; blocks until Ctrl+C) |
| `gojo server start --daemon` | Same, but return immediately (process keeps running) |
| `gojo server status` | PID / health |
| `gojo server stop` | Stop via PID file |
| `gojo server doctor` | Git, disk, DB, adapter detection, daemon PATH tools, network warnings |
| `gojo instance show` | Bind, publicBaseUrl, trusted proxies, resolved apiBaseUrl |
| `gojo instance set …` | Update network fields in `instance.yaml` (restart after) |

`gojo setup` is create-once. If an admin already exists it exits with code `3` and tells you to use `gojo auth password` instead.

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
| `GOJO_SOURCE_TOKEN=… gojo source token set <sourceId> [--secret-name <name>]` | Store/rotate a forge API token and attach its secret reference (secure prompt on a TTY) |

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
| `gojo approval list\|show\|approve\|reject\|hold` | Inspect and decide platform-owned PR approvals |
| `gojo work claim <workItemId> --agent <name-or-id>` | Explicitly enqueue an issue against an eligible issue-triggered agent |

Failed runs may enqueue a project **self-heal** agent when the manifest declares `selfHeal` — see [Self-healing](/self-healing).
For the label-triggered triage → implementation → review workflow, see
[Issue-driven agents](/issue-driven-agents).

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
- [Issue-driven agents](/issue-driven-agents)
