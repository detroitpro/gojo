---
layout: ../layouts/DocLayout.astro
title: Agent prompt best practices
description: How to write gojo agent prompts that stay safe unattended — shared instructions, hard numeric limits, clear stop conditions, and a handoff.
---

Unattended agents drift without bounds. A good `promptFile` is less "do everything useful" and more "do one bounded unit of work, stop, leave a trail."

Use this with [Your first agent](/first-agent) (pipeline) and [Advanced agent](/advanced-agent) (full AI example). Manifest fields: [Settings](/settings).

## What actually moves the needle

| Layer | Impact | Notes |
| --- | --- | --- |
| Numeric Hard rules | Highest | Caps keep the *diff* reviewable; timeouts only stop the process |
| Shared `instructions` | High | Same qualities on every AI agent; cut duplicated boilerplate |
| How you report (handoff) | High | Thin PRs are a common failure mode — spell out what/why/value |
| How you think | Moderate | Only 2–4 **role-specific** heuristics that change tradeoffs |
| Chat "personality" | Low | Skip for unattended cron |

## Name agents without cadence

Agent and schedule keys in `gojo.yaml` are durable identities (sync matches by name). **Do not** put frequency in the key (`maintain-deps-weekly`, `nightly-note`). Cadence belongs only in `cron` / `timezone`, which you can change without renaming.

```yaml
# Good — key is the work; cron is the cadence
agents:
  maintain-deps:
    # ...
schedules:
  maintain-deps:
    agent: maintain-deps
    cron: "0 2 * * 0"
    timezone: America/Detroit
```

When one schedule maps to one agent, use the **same key** for both. Project sync soft-disables agents and schedules that disappear from the manifest (rows stay for history).

## Shared project instructions

Put cross-agent defaults in the manifest so every AI run gets them without copy-paste:

```yaml
instructions:
  files:
    - .gojo/instructions.md
  scheduledRunNotice: |
    Unattended scheduled run. Prefer small diffs. Write .gojo/handoff.json.
```

At run time gojo prepends `scheduledRunNotice`, then each listed file (from the worktree), then your `promptFile`, then the validation gate. Missing listed files fail the run. Shell adapters skip this layer (the prompt is a script).

Use the shared file for code qualities, "no features / no secrets / stay in worktree," and handoff judgment. Keep **agent-specific** goals, scope, numeric limits, and process in the `promptFile`.

## Start with constrained limits

**Put numeric caps in Hard rules from day one.** Widen them later when a schedule has proven itself.

Without a limit, a weekly "improve tests" or "update deps" run will try to boil the ocean inside a 45-minute timeout — huge diffs, flaky PRs, and painful review.

| Agent type | Example hard limit (start here) |
| --- | --- |
| Tests / coverage | At most **5** new test cases per run |
| Refactors / quality | **One** theme; at most **8** source files |
| Dependencies | At most **8** direct bumps; at most **2** majors |
| Docs | At most **5** files; at most **1** new page |
| PR babysit / merge | At most **3** allowlisted PRs |
| Self-heal | **One** root cause; at most **5** files |

When the adapter hits the limit with a green tree, it should stop and put the remainder in `recommendedNextActions` — not stretch the run.

Platform knobs (timeouts, `projectLimit`, `maxAttemptsPerRun`) are **not** a substitute for prompt limits. Timeouts stop the process; limits keep the *diff* reviewable.

## Prompt shape that works

Structure every AI agent prompt the same way:

1. **Role** — who you are for this agent (thin expertise line is enough).
2. **Goals** — 3–5 outcomes, not a wishlist.
3. **Scope** — paths in / paths out.
4. **How you think** (optional) — 2–4 role-specific heuristics only if they change a choice under the limit (skip generic "think step by step").
5. **Hard rules** — safety + **numeric limits** (non-negotiable).
6. **Process** — short ordered steps.
7. **Required handoff** — `.gojo/handoff.json` with **what / why / value** (see below).

### How you think (when useful)

Good (changes tradeoffs):

```markdown
## How you think
- Prefer behavior and edge cases over trivial getters.
- Prefer patch/minor unless security or EOS justifies a major.
- One root cause only — do not chase every failure.
```

Skip ritual personality or "be careful" filler. Shared project instructions already cover universal qualities.

### Hard rules checklist

- Who owns Git? (Usually: adapter does **not** push/merge; gojo `pull-request` / `commit-only` does — unless the agent is explicitly a babysitter.)
- No secrets, no weakening CI, no inventing features (also in shared instructions when you use them).
- Stay in the worktree.
- **Explicit caps** (files, packages, tests, PRs, themes).
- What to do when unfinished work remains (`recommendedNextActions`).

## Handoff drives the pull request

When `integration.mode` is `pull-request`, **gojo** opens the PR with `integration.prTool` (`gh` or `tea`; default `gh`) — the adapter must not. The PR title and body are built from `.gojo/handoff.json`:

| Handoff field | PR use |
| --- | --- |
| `assets` (`pr-title`) | Preferred PR title (first line) |
| `assets` (`pr-body`) | Preferred full PR body (verbose markdown via `path`) |
| `summary` (first line) | PR title when no `pr-title` asset |
| `summary` (full) | Opening "Summary" section when no `pr-body` — include **what**, **why**, and **value** |
| `decisions` | Decisions section when no `pr-body` |
| `filesChanged` | Files changed (fallback body) |
| `unresolvedIssues` / `recommendedNextActions` | Follow-ups (fallback body) |

For long PR descriptions, write markdown under `.gojo/assets/` and reference it from `assets` instead of stuffing everything into `summary`. Like the handoff itself, assets are run output: gojo copies them into the run artifacts and keeps them out of the commit, so never `git add` them from a prompt. Without a rich handoff, reviewers only see an agent name like `maintain-tests`. Prompt the adapter to write the PR story into the handoff, not into a manual `gh pr create` / `tea pulls create`.

## Impact claims feed the dashboard

Handoff schema v2 adds `impact.items` — structured outcome claims the dashboard aggregates. Prompt adapters to report **one item per concrete subject** (one package, one issue, one doc page), never totals:

```json
"impact": {
  "items": [
    {
      "category": "bug-fix",
      "subject": "issue-127",
      "summary": "Fixed timezone drift in cron next-run computation",
      "confidence": 0.85,
      "evidence": { "files": ["src/scheduler/cron.ts"], "references": ["#127"] }
    }
  ]
}
```

Categories: `dependency-update`, `bug-fix`, `bug-prevention`, `documentation`, `test-coverage`, `security`, `feature`, `performance`, `maintenance`. Claims whose `evidence.files` match the real diff are marked **corroborated**; machine-detectable changes (deps, docs, tests) are recorded as **verified** platform facts. Speculative or duplicate claims stay labeled **claimed** — tell agents not to pad.

## Source-side effects use schema v3 (`subjectActions`)

Report-only and issue-driven agents must not call forge APIs with write tokens. Instead, use handoff **schema v3** and let gojo validate and apply mutations with platform credentials:

```json
{
  "schemaVersion": 3,
  "subjectActions": {
    "addLabels": ["gojo:validated"],
    "removeLabels": ["gojo:in-progress"],
    "comment": "Brief is actionable — implement X with tests for Y."
  }
}
```

Review agents return a single `verdict`: `pass`, `changes-requested`, or `reject` (optionally with a `comment`). Triage agents use labels + comments; implementation agents usually omit `subjectActions` and rely on `pull-request` integration. v2 `impact.items` and v3 `subjectActions` can coexist. Full workflow: [Issue-driven agents](/issue-driven-agents).

### Minimal Hard rules sketch

```markdown
## Hard rules
- Do **not** push, open PRs, or merge. gojo owns Git integration.
- Do **not** weaken CI or commit secrets.
- **Limit:** <N> <units> per run (e.g. 5 new tests, 8 files, 3 PRs).
- Prefer the smallest change set that meets the goals.
- If more work remains, stop at the limit and list it in `recommendedNextActions`.
```

## Pair limits with platform policy

| Concern | Prompt limit | Manifest |
| --- | --- | --- |
| Diff size / reviewability | Files, tests, packages, themes | — |
| Shared defaults | — | `instructions.files` / `scheduledRunNotice` |
| Runtime | "Stop at limit" | Profile `timeout` |
| Overlap | One theme / one root cause | `concurrency.projectLimit: 1`, `overlapPolicy: skip` |
| Bad weeks | Deferred list in handoff | `failurePolicy` + optional `selfHeal` |
| Integration | Who may push/merge | `integration.mode` |

See [Advanced usage](/advanced-usage) for concurrency, approvals, and [Self-healing](/self-healing) for healers (healers need the same one-root-cause limit).

## Report-only agents (forge side effects)

Not every agent should change the Git tree. For work that only talks to the forge (issue labels, triage notes, status checks via `gh` / `tea`), **omit `integration`** in `gojo.yaml` so the run ends in reporting mode with no commit or PR. Pair with a light validation profile (`noop` or "handoff exists").

This repository dogfoods that pattern as **`maintain-issue-tags`**:

| Piece | Role |
| --- | --- |
| [`.gojo/labels.md`](https://github.com/detroitpro/gojo/blob/main/.gojo/labels.md) | Owned label taxonomy (`area:*`, `domain:*`, reserved `gojo:*`) |
| [`.gojo/agents/maintain-issue-tags.md`](https://github.com/detroitpro/gojo/blob/main/.gojo/agents/maintain-issue-tags.md) | Prompt: reconcile labels, triage open issues, write handoff |
| `gojo.yaml` agent `maintain-issue-tags` | `profile: cursor`, `validationProfile: noop`, **no** `integration` block |

Copy the shape for your repo: keep a labels doc as the single authority, cap
issues per run, and forbid inventing labels in the prompt. The shipped
issue-driven pipeline uses `gojo:ready`, `gojo:validated`,
`gojo:in-progress`, and `gojo:blocked` as a durable claim state machine. See
[Issue-driven agents](/issue-driven-agents) for the trigger, triage,
implementation, review, and approval contract.

### Digest agents (the message *is* the deliverable)

A digest agent is report-only with one extra property: its `summary` is delivered verbatim as the notification body (see [Notifications](/notifications)). Nothing downstream rewrites it, so the prompt has to ask for the finished message.

The failure mode is a prompt that asks for *activity* and gets a list of pull request titles back. Titles restate the branch name; they do not tell the reader what the system does now. The opposite failure is just as bad — vague outcome prose with no technical content. Ask for an **executive brief** written for a reader who could read the diff but does not have time to:

- **One entry per merge**, led by what changed and what it now does — not the pull request title.
- **Format as header + details:** `**bold header**` on its own line, blank line, then a detail paragraph, blank line before the next item. The platform turns `**…**` into Telegram bold; packing header and detail onto adjacent lines is what makes digests feel like a wall of text.
- **Name the technical surface:** the module, endpoint, table, column, CLI command, or component that moved. Specific enough that the reader could go look at it.
- **Give the mechanism when it explains the impact:** a migration, a new column, a changed default, an added index, a boundary moved between layers.
- **Then the effect:** what behavior changed, what failure mode is gone, what it unblocks.
- **Treat every merge equally.** Refactors, test-only work, dependency bumps, and docs are changes to the system and get the same entry as a feature — no maintenance bucket, no group reduced to a count. Give refactors and tests the boundary that moved or the surface now covered, and the class of bug that prevents.
- **Require the adapter to read each merge** (`gh pr view <n> --json title,body,files`, falling back to `gh pr diff`, or `tea pulls list --fields index,title,body` plus `git show`). A prompt that only lists cannot explain.
- **Do not repeat merged work as "opened."** If it merged, opening it is implied.
- **Cap the length** to the channel limit — Telegram truncates past 4096 characters. On heavy days tighten each entry rather than dropping any.

This repository dogfoods it as **`activity-digest`**: [`.gojo/agents/activity-digest.md`](https://github.com/detroitpro/gojo/blob/main/.gojo/agents/activity-digest.md), `validationProfile: handoff`, no `integration` block, and an agent-level `notifications` block so it is the only agent that pages you.

## Dogfood reference

This repository's scheduled maintenance prompts under [`.gojo/agents/`](https://github.com/detroitpro/gojo/tree/main/.gojo/agents) and shared [`.gojo/instructions.md`](https://github.com/detroitpro/gojo/blob/main/.gojo/instructions.md) use the patterns above. Copy them; tighten further for riskier repos.

## Related

- [Advanced agent](/advanced-agent) — full dependency-maintenance prompt example
- [Issue-driven agents](/issue-driven-agents) — triage, implementation, and review prompt responsibilities
- [Advanced usage](/advanced-usage) — multi-role agents and operating hygiene
- [Concepts](/concepts) — why the platform owns success and merge
- [Settings](/settings) — agent and schedule fields
