---
layout: ../layouts/DocLayout.astro
title: FAQ
description: Common questions after installing gojo or adding your first project.
---

## I added a project — now what?

Registering a project only stores the repo path. Next:

1. Put a [`gojo.yaml`](/first-agent) in the repo (agents + profile + validation).
2. **Sync** the project in the UI or CLI.
3. Run an agent (start with the [shell example](/first-agent)).
4. Open **Runs** to watch state, logs, and the handoff.

No manifest → no agents after sync.

## Where is the UI?

After `gojo server start`, open **http://127.0.0.1:7430** unless you changed the bind port.

## Why can't I type a repo path in the UI?

The browser can't safely expose absolute host paths. Use **Browse…** — gojo lists directories on the machine running the server.

## Does gojo need Cursor or Claude?

No. The **shell** adapter is enough to prove the pipeline. Add Cursor Agent or Claude Code CLIs when you want coding agents.

## What is the difference between Adapters and Agents in the UI?

**Adapters** is host-level detection: which coding-agent CLIs are installed (shell / cursor / claude-code) and whether they authenticate. **Agents** is the list of *work units* defined in a project's `gojo.yaml` (each picks a profile that references one of those adapters).

## Will the adapter push to main?

Not by default, and not if you follow the model: integration modes are platform-owned (`commit-only`, `pull-request`, `await-approval`, `auto-merge`). Prefer PR or approval on shared repos.

## Where does gojo store data?

`~/.gojo` by default (`GOJO_HOME` to override): SQLite database, worktrees, artifacts, secrets key, instance config.

## Can I expose gojo on the network?

Yes, but only with intention: change bind host, put TLS/auth in front, and treat the instance as able to run repository commands. Default localhost binding is deliberate.

## A schedule keeps failing — why did it disappear?

Schedules can **auto-disable** after consecutive failures. You'll get a notification if channels are configured. Re-enable explicitly after fixing the cause.

## Can gojo fix a failed agent by itself?

Partially. The platform retries transient failures (`maxAttemptsPerRun`) and can enqueue a project's **self-heal** agent when you declare `selfHeal` in the manifest. The healer lives **in the project repo** and should open a PR for human review — gojo does not silently rewrite prompts in the database. Details: [Self-healing](/self-healing).

## I merged a healer PR — why is the agent still broken?

Ensure `repository.syncBeforeRun: true` in `gojo.yaml`, and that the next run uses a daemon build that implements fetch + manifest re-sync. Without that, gojo keeps branching from a stale local `main` and an unsynced DB prompt.

## How do I stop everything quickly?

Use **global pause** in Settings / API, or `gojo server stop` / service stop. Cancel individual runs from the Runs UI or CLI.

## Is the public website the same as the ops UI?

No. This **site/** package is the public marketing and docs site. The ops UI is served by the gojo server itself after you start it.

## How do I run a serious AI coding agent?

Start with [Your first agent](/first-agent) (shell) to prove validation and commits, then use [Advanced agent](/advanced-agent) for Claude Code / Cursor with PRs, schedules, and handoffs. Put **constrained limits** in Hard rules from day one ([Agent prompt best practices](/agent-prompts)). More patterns: [Advanced usage](/advanced-usage).

## Related

- [Getting started](/getting-started)
- [Your first agent](/first-agent)
- [Advanced agent](/advanced-agent)
- [Agent prompt best practices](/agent-prompts)
- [Self-healing](/self-healing)
- [Documentation](/docs)
