---
layout: ../layouts/DocLayout.astro
title: Project visibility and sources
description: See what agents, people, bots, and external systems are working on without stale open-work counts.
---

## One command center, every source

A project page is organized around four questions:

- **Now:** What is running or queued, who owns it, and what is the current focus?
- **Needs attention:** What is blocked, awaiting approval, stale, or failing to sync — and what should you do next?
- **Delivery:** What pull requests, issues, tickets, incidents, or deployments are active?
- **History:** What completed, was verified terminal, or was marked resolved by an operator? Rows use icon badges for type and result (with accessible labels), keep the durable agent name for runs (with progress as a subtitle), show which agent/profile produced the work separately from the platform/repo source, and nest a delivered PR under its run when a `delivers` link exists.

Command-center actions use shared icon buttons (`AppButton`) with consistent primary / secondary / danger variants and a loading state while long-running work is in flight.

Status counts (Working, Queued, Needs attention, Verified open, Stale open) use
shared metric tiles: each has a tone-coded icon, and attention metrics show a
notification flag when non-zero. When history exists, a delta chip compares the
count to the same hour one day ago (or the prior impact window for Merged /
Commits / Merge rate). Impact categories (Dependency updates, Bugs fixed, Test
updates, …) use the same tile pattern with outcome labels and icons; each count
is the number of distinct runs that produced that category of impact, not a
breakdown by verification level.

The dashboard is a gateway: inventory tiles open Projects / Agents / Schedules /
Runs, delivery tiles open Integrations (Open / Merged / Commits), and category
tiles open the Impact items list for that category — so you can dig into the
non-summarized records behind each number.

Work is not limited to gojo-created pull requests. Human and bot work discovered
from connected systems appears with explicit provenance and source.

## Verified does not mean “last known”

Every external item shows its source observation time and sync state. An open
item counts as **verified open** only while its source observation is current.
If polling or webhook delivery fails, gojo keeps the last known record under
**stale open** and **Needs attention** instead of continuing to present it as
current.

When a complete source snapshot no longer includes an open item, gojo tries to
verify that item individually. Confirmed merged or closed work moves to
**History** automatically. If the provider cannot confirm the final state, the
row stays under Needs attention with actions:

- **Open in source** — inspect the upstream issue or pull request
- **Recheck now** — verify one item against its provider
- **Retry source** — refresh the whole source after a sync error
- **Mark resolved** — clear attention without inventing merged/closed delivery;
  the item stays in History and returns if the source later reports it active

Repository sources poll active work every minute. Incomplete pages never mark
unseen work stale. Errors back off, but gojo never permanently abandons a
nonterminal item. Webhooks make changes appear quickly; polling repairs missed
events.

## Supported sources

Gojo includes adapters for:

- GitHub pull requests and issues
- GitLab merge requests and issues
- Forgejo/Gitea pull requests and issues
- signed generic work webhooks for trackers, incidents, deployments, documents,
  and internal systems

The repository source is discovered from `origin` when a project is registered
or synced. Provider credentials can use encrypted secret references; the
standard `GH_TOKEN`/`GITHUB_TOKEN`, `GITLAB_TOKEN`, and
`FORGEJO_TOKEN`/`GITEA_TOKEN` environment variables remain compatibility
fallbacks. For GitHub, Gojo also uses the active `gh` CLI login when no token is
configured explicitly.

Use `gojo project sources <project-id>` to find the source id, then store or
rotate its write token in the encrypted secret store:

```bash
gojo source token set <source-id> --secret-name source-github
gojo server doctor
```

Source write adapters use that credential for platform-owned comments, labels,
diffs, check reconciliation, and approved merges. Gojo-managed forge tokens are
removed from agent and validation environments.

Attach additional sources with `POST /api/v1/projects/:id/sources`. A generic
webhook connection stores only `webhookSecretName` in its configuration; put
the actual value in gojo Secrets. Send events to
`POST /api/v1/sources/:sourceId/events` with:

```text
X-Gojo-Signature: sha256=<HMAC-SHA256 of the exact request body>
```

Each body has a durable delivery `id`, ISO `occurredAt`, and an `item` with at
least `kind`, `nativeKey`, `title`, and `nativeState`. Duplicate deliveries are
safe and an older event cannot overwrite a newer observation.

## Adapter focus

AI runs receive a short-lived token restricted to their own progress endpoint.
Adapter subprocesses can report a title, summary, blocker, and references while
running. The project page uses this structured update; it does not scrape
console output to guess what an agent is doing.

## Live updates

Dashboard, queue, runs, agents, schedules, projects, impact, and project work
refresh as durable changes arrive. The application shell shows **Live** while
the event stream is connected and **Reconnecting** when it is using its
degraded fallback. Reopening the page or restarting the daemon does not create
a visibility gap: the browser resumes from its last event sequence and then
reloads canonical API data.

## CLI

```bash
gojo project status <project-id>
gojo project work <project-id> --delivery open --attention stale
gojo project sources <project-id>
gojo project refresh-source <project-id> <source-id>
gojo project recheck-work <project-id> <work-item-id>
gojo project resolve-work <project-id> <work-item-id> --note "closed upstream"
```

Filter work with `--kind`, `--provenance`, `--delivery`, and `--attention` (enum values match the API). Use `--output json` for automation. Full command map: [CLI](/cli).

## Related

- [Issue-driven agents](/issue-driven-agents) — turn source issues into reviewed pull requests
- [Concepts](/concepts) — ownership and success boundaries
- [CLI](/cli) — command reference
- [Settings](/settings) — projects, secrets, and integrations
