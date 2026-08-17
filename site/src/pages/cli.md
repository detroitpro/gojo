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
| `gojo instance sweep-worktrees` | Remove orphan worktrees not attached to a live run (also runs on daemon start) |
| `gojo instance scheduling-show` | Read admission caps (`maxConcurrentRuns`, per-project limits, stagger, load guard) |
| `gojo instance scheduling-set …` | Update scheduling policy caps (same fields as `PATCH /api/v1/instance/scheduling`) |

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
| `gojo project add <name> <repoPath> [--branch] [--remote <url>]` | Register a repo (`--remote` stores the git remote URL; omit to infer from `git remote get-url origin`) |
| `gojo project list\|inspect\|sync\|enable\|disable\|doctor\|remove` | Manage projects (`enable`/`disable` are runtime gates; Sync reapplies YAML) |
| `gojo project work <id> [--kind …] [--provenance …] [--delivery …] [--attention …] [--history]` | Paged work ledger (**first page only**, 25 items; filters match API enums; `--history` includes completed/verified-terminal items; use the HTTP API with `limit`/`offset` for more) |
| `gojo project status <id>` | Canonical work counts (verified open, stale, attention, …) |
| `gojo project sources <id>` | Connected sources and sync health |
| `gojo project refresh-source <id> <sourceId>` | Reconcile one source immediately |
| `gojo project recheck-work <id> <workItemId>` | Verify one work item against its provider |
| `gojo project resolve-work <id> <workItemId> [--by …] [--note …]` | Operator-resolve attention without inventing delivery |
| `gojo project migrate-vocab (--path <repoPath> \| <projectId>)` | One-time Tasks→Agents vocabulary rewrite in a checkout (manifest keys, `promptFile` paths, `.gojo/tasks/` → `.gojo/agents/`) |

## Source credentials

| Command | Purpose |
| --- | --- |
| `gojo source token set <sourceId> [--secret-name <name>]` | Store/rotate a forge API token in the encrypted secret store (secure prompt on a TTY) |

For automation, supply the token only for that command:

```bash
GOJO_SOURCE_TOKEN="$TOKEN" gojo source token set <sourceId> --secret-name source-forgejo
```

See [Project visibility and sources](/project-visibility) and [Issue-driven agents](/issue-driven-agents) for when to rotate source write tokens.

## Adapters (detection)

| Command | Purpose |
| --- | --- |
| `gojo adapter detect\|list\|inspect\|test` | Discover and probe installed agent CLIs |

## Agents & schedules

| Command | Purpose |
| --- | --- |
| `gojo agent list --project <id>\|inspect\|run\|enable\|disable` | Inspect, run, and enable/disable (`list` requires `--project` and returns the full unpaged set for that project; `GET /api/v1/agents` is paged; `inspect` returns read-only prompt/policy plus manifest `source` paths when synced; `run` enqueues then **blocks** until the run reaches a terminal state) |
| `gojo agent cancel\|retry <runId>` | Cancel or re-enqueue a run by **run** id (not agent id); `retry` also blocks until terminal |
| `gojo schedule list\|enable\|disable\|pause\|next` | Timers (`list` returns the full unpaged set; `GET /api/v1/schedules` is paged) |

## Runs

| Command | Purpose |
| --- | --- |
| `gojo run list [--project <id>]\|inspect\|logs\|diff\|artifacts` | Observe (`list` returns the full unpaged set — all projects or one `--project`; `GET /api/v1/runs` is paged with `limit`/`offset`; `logs` dumps stored event history; for live tail use the Runs UI; `artifacts` returns handoff, validation, and failure JSON) |
| `gojo integration list [--all\|--open\|--merged\|--committed] [--project <id>]` | List gojo-tracked integrations (default: open+merged; **first page only**, 25 items — use the HTTP API with `limit`/`offset` for more) |
| `gojo run approve <id>` | Approve an `await-approval` run so integration continues with `postApprovalMode` |
| `gojo run reject <id> [--reason <text>]` | Reject an `await-approval` run (optional reason is stored on the run) |
| `gojo approval list [--state <state>] [--project <id>]\|show\|approve\|reject\|hold\|set-autonomy` | Inspect and decide platform-owned PR approvals (`set-autonomy` sets `manual\|reviewer\|auto`; `list` is **first page only**, 25 items) |
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
