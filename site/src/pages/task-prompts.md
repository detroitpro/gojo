---
layout: ../layouts/DocLayout.astro
title: Task prompt best practices
description: How to write gojo task prompts that stay safe unattended — shared instructions, hard numeric limits, clear stop conditions, and a handoff.
---

Unattended agents drift without bounds. A good `promptFile` is less “do everything useful” and more “do one bounded unit of work, stop, leave a trail.”

Use this with [Your first agent](/first-agent) (pipeline) and [Advanced agent](/advanced-agent) (full AI example). Manifest fields: [Settings](/settings).

## What actually moves the needle

| Layer | Impact | Notes |
| --- | --- | --- |
| Numeric Hard rules | Highest | Caps keep the *diff* reviewable; timeouts only stop the process |
| Shared `instructions` | High | Same qualities on every AI task; cut duplicated boilerplate |
| How you report (handoff) | High | Thin PRs are a common failure mode — spell out what/why/value |
| How you think | Moderate | Only 2–4 **role-specific** heuristics that change tradeoffs |
| Chat “personality” | Low | Skip for unattended cron |

## Name tasks without cadence

Task and schedule keys in `gojo.yaml` are durable identities (sync matches by name). **Do not** put frequency in the key (`maintain-deps-weekly`, `nightly-note`). Cadence belongs only in `cron` / `timezone`, which you can change without renaming.

```yaml
# Good — key is the work; cron is the cadence
tasks:
  maintain-deps:
    # ...
schedules:
  maintain-deps:
    task: maintain-deps
    cron: "0 2 * * 0"
    timezone: America/Detroit
```

When one schedule maps to one task, use the **same key** for both. Project sync soft-disables tasks and schedules that disappear from the manifest (rows stay for history).

## Shared project instructions

Put cross-task defaults in the manifest so every AI run gets them without copy-paste:

```yaml
instructions:
  files:
    - .gojo/instructions.md
  scheduledRunNotice: |
    Unattended scheduled run. Prefer small diffs. Write .gojo/handoff.json.
```

At run time gojo prepends `scheduledRunNotice`, then each listed file (from the worktree), then your `promptFile`, then the validation gate. Missing listed files fail the run. Shell adapters skip this layer (the prompt is a script).

Use the shared file for code qualities, “no features / no secrets / stay in worktree,” and handoff judgment. Keep **task-specific** goals, scope, numeric limits, and process in the `promptFile`.

## Start with constrained limits

**Put numeric caps in Hard rules from day one.** Widen them later when a schedule has proven itself.

Without a limit, a weekly “improve tests” or “update deps” run will try to boil the ocean inside a 45-minute timeout — huge diffs, flaky PRs, and painful review.

| Task type | Example hard limit (start here) |
| --- | --- |
| Tests / coverage | At most **5** new test cases per run |
| Refactors / quality | **One** theme; at most **8** source files |
| Dependencies | At most **8** direct bumps; at most **2** majors |
| Docs | At most **5** files; at most **1** new page |
| PR babysit / merge | At most **3** allowlisted PRs |
| Self-heal | **One** root cause; at most **5** files |

When the agent hits the limit with a green tree, it should stop and put the remainder in `recommendedNextActions` — not stretch the run.

Platform knobs (timeouts, `projectLimit`, `maxAttemptsPerRun`) are **not** a substitute for prompt limits. Timeouts stop the process; limits keep the *diff* reviewable.

## Prompt shape that works

Structure every AI task prompt the same way:

1. **Role** — who you are for this task (thin expertise line is enough).
2. **Goals** — 3–5 outcomes, not a wishlist.
3. **Scope** — paths in / paths out.
4. **How you think** (optional) — 2–4 role-specific heuristics only if they change a choice under the limit (skip generic “think step by step”).
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

Skip ritual personality or “be careful” filler. Shared project instructions already cover universal qualities.

### Hard rules checklist

- Who owns Git? (Usually: agent does **not** push/merge; gojo `pull-request` / `commit-only` does — unless the task is explicitly a babysitter.)
- No secrets, no weakening CI, no inventing features (also in shared instructions when you use them).
- Stay in the worktree.
- **Explicit caps** (files, packages, tests, PRs, themes).
- What to do when unfinished work remains (`recommendedNextActions`).

## Handoff drives the pull request

When `integration.mode` is `pull-request`, **gojo** opens the PR with `integration.prTool` (`gh` or `tea`; default `gh`) — the agent must not. The PR title and body are built from `.gojo/handoff.json`:

| Handoff field | PR use |
| --- | --- |
| `assets` (`pr-title`) | Preferred PR title (first line) |
| `assets` (`pr-body`) | Preferred full PR body (verbose markdown via `path`) |
| `summary` (first line) | PR title when no `pr-title` asset |
| `summary` (full) | Opening “Summary” section when no `pr-body` — include **what**, **why**, and **value** |
| `decisions` | Decisions section when no `pr-body` |
| `filesChanged` | Files changed (fallback body) |
| `unresolvedIssues` / `recommendedNextActions` | Follow-ups (fallback body) |

For long PR descriptions, write markdown under `.gojo/assets/` and reference it from `assets` instead of stuffing everything into `summary`. Without a rich handoff, reviewers only see a task name like `maintain-tests`. Prompt the agent to write the PR story into the handoff, not into a manual `gh pr create` / `tea pulls create`.

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
| Runtime | “Stop at limit” | Agent `timeout` |
| Overlap | One theme / one root cause | `concurrency.projectLimit: 1`, `overlapPolicy: skip` |
| Bad weeks | Deferred list in handoff | `failurePolicy` + optional `selfHeal` |
| Integration | Who may push/merge | `integration.mode` |

See [Advanced usage](/advanced-usage) for concurrency, approvals, and [Self-healing](/self-healing) for healers (healers need the same one-root-cause limit).

## Dogfood reference

This repository’s scheduled maintenance prompts under [`.gojo/tasks/`](https://github.com/detroitpro/gojo/tree/main/.gojo/tasks) and shared [`.gojo/instructions.md`](https://github.com/detroitpro/gojo/blob/main/.gojo/instructions.md) use the patterns above. Copy them; tighten further for riskier repos.

## Related

- [Advanced agent](/advanced-agent) — full dependency-maintenance prompt example
- [Advanced usage](/advanced-usage) — multi-role agents and operating hygiene
- [Concepts](/concepts) — why the platform owns success and merge
- [Settings](/settings) — task and schedule fields
