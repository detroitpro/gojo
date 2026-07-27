---
layout: ../layouts/DocLayout.astro
title: Documentation
description: Guides and reference for operating gojo — from first shell task to production AI agents.
---

## Guides

- [Getting started](/getting-started) — install, setup, add a project, sync
- [Your first agent](/first-agent) — shell task end-to-end (learn the pipeline)
- [Advanced agent](/advanced-agent) — Claude Code / Cursor dependency maintenance with PRs
- [Task prompt best practices](/task-prompts) — constrained limits, hard rules, handoffs
- [Advanced usage](/advanced-usage) — multi-role agents, approvals, secrets, hygiene
- [Self-healing](/self-healing) — recover from failed tasks with in-repo healer PRs

## Reference

- [Settings](/settings) — instance, schedules, validation, integration
- [Notifications](/notifications) — channels, routing, delivery
- [Concepts](/concepts) — success ownership, worktrees, runs, handoffs
- [CLI](/cli) — command map
- [FAQ](/faq) — common questions after adding a project

## UI tour

After `gojo server start` (or `gojo service start`), open [http://127.0.0.1:7430](http://127.0.0.1:7430).

![gojo dashboard](/images/ui-dashboard.png)

**Dashboard** — counts, pause/resume, an Impact panel (merged automation, PR states, merge rate, and category counts as stats), and per-project tables of enabled tasks with a last-five-runs strip. **PRs open** links to projects with open automation PRs (or that project’s Open PRs panel when filtered). Per-item impact audit lives on project detail and run detail.

![gojo projects](/images/ui-projects.png)

**Projects** — register Git repos via **Add project** (header → dialog), see **Open PRs** counts, open a project for health, remote link, open and recently merged PR lists (with merge babysitter enqueue when `maintain-merge` exists), Impact detail, structured config, and sync manifests.

**Tasks** — list synced tasks with success rate and last run. Open a task for read-only inspect: last-synced prompt, policy JSON (validation, integration, failure, concurrency), linked schedules, manifest source paths, and a recent-runs strip. Run now, enable/disable, and jump to filtered Runs or Schedules. Edit config in `gojo.yaml` + `promptFile`, then **Project Sync** — the detail page is ops inspect, not an editor.

![gojo runs list](/images/ui-runs.png)

**Runs** — filterable history across projects, with state and trigger.

![gojo schedules](/images/ui-schedules.png)

**Schedules** — human-readable cron, relative next fire, and a future-runs timeline.

![gojo run detail](/images/ui-run-detail.png)

**Run detail** — phase timeline, token/cost estimate, the activity feed for a single attempt, and the run's canonical impact items and integration outcome (PR merged/closed status) backing the dashboard numbers.
