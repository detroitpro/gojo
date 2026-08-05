---
layout: ../layouts/DocLayout.astro
title: Documentation
description: Guides and reference for operating gojo — from first shell agent to production AI agents.
---

## Guides

- [Getting started](/getting-started) — install, setup, add a project, sync
- [Your first agent](/first-agent) — shell agent end-to-end (learn the pipeline)
- [Advanced agent](/advanced-agent) — Claude Code / Cursor dependency maintenance with PRs
- [Agent prompt best practices](/agent-prompts) — constrained limits, hard rules, handoffs
- [Issue-driven agents](/issue-driven-agents) — start trusted work from a forge issue and control review, repair, and merge remotely
- [Advanced usage](/advanced-usage) — multi-role agents, approvals, secrets, hygiene
- [Self-healing](/self-healing) — recover from failed agents with in-repo healer PRs

## Reference

- [Settings](/settings) — instance, schedules, validation, integration
- [Notifications](/notifications) — channels, routing, delivery
- [Concepts](/concepts) — success ownership, worktrees, runs, handoffs
- [Project visibility and sources](/project-visibility) — current work, provenance, freshness, and connectors
- [CLI](/cli) — command map
- [FAQ](/faq) — common questions after adding a project

## UI tour

After `gojo server start` (or `gojo service start`), open [http://127.0.0.1:7430](http://127.0.0.1:7430).

![gojo dashboard](/images/ui-dashboard.png)

**Dashboard** — full-width ops gateway: inventory tiles (projects, agents, schedules, runs), an Impact strip (merged, PRs open, merge rate, commits, succeeded runs, and category totals), and per-project agent lists with a last-five-runs strip. Every metric tile drills into the list behind it — Integrations, Impact items, Runs, and so on.

**Queue** — waiting runs with admission positions, instance scheduling policy caps, and what is actively running.

![gojo projects](/images/ui-projects.png)

**Projects** — register Git repos via **Add project** (header → dialog), see **Open PRs** counts. Open a project for sub-pages: **Overview** (activity briefing and needs-attention queue), **History**, **Impact**, **Health**, and **Configuration** (synced manifest). Sync, enable/disable, and remove from the project shell header.

![gojo agents](/images/ui-agents.png)

**Agents** — list synced agents with success rate and last run. Open an agent for read-only inspect: last-synced prompt, policy JSON (validation, integration, failure, concurrency), linked schedules, manifest source paths, and a recent-runs strip. Run now, enable/disable, and jump to filtered Runs or Schedules. Edit config in `gojo.yaml` + `promptFile`, then **Project Sync** — the detail page is ops inspect, not an editor.

![gojo adapters](/images/ui-adapters.png)

**Adapters** — detection results for shell / cursor / claude-code on the host: install status, version, and whether the CLI authenticated. `gojo adapter detect` mirrors it for scripting.

![gojo runs list](/images/ui-runs.png)

**Runs** — filterable history across projects, with state and trigger.

![gojo schedules](/images/ui-schedules.png)

**Schedules** — human-readable cron, relative next fire, and a future-runs timeline.

![gojo integrations](/images/ui-integrations.png)

**Integrations** — Open / Merged / Commits tabs over `run_integrations`, with project filters and links into run detail. Dashboard Merged / Commits / Merge rate tiles land here.

**Approvals** — mobile-friendly evidence cards for checks, independent reviewer verdict, repair count, source or mirrored diff, and platform-owned Approve / Hold / Reject controls.

![gojo impact items](/images/ui-impact.png)

**Impact** — paged impact items (category, subject, verification) behind the dashboard category totals. Filter by category or project; each row opens the producing run.

![gojo run detail](/images/ui-run-detail.png)

**Run detail** — phase timeline, token/cost estimate, the activity feed for a single attempt, and the run's canonical impact items and integration outcome (PR merged/closed status) backing the dashboard numbers.
