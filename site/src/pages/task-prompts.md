---
layout: ../layouts/DocLayout.astro
title: Task prompt best practices
description: How to write gojo task prompts that stay safe unattended — start with hard numeric limits, clear stop conditions, and a handoff.
---

Unattended agents drift without bounds. A good `promptFile` is less “do everything useful” and more “do one bounded unit of work, stop, leave a trail.”

Use this with [Your first agent](/first-agent) (pipeline) and [Advanced agent](/advanced-agent) (full AI example). Manifest fields: [Settings](/settings).

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

1. **Role** — who you are, which repo, unattended scheduled run.
2. **Goals** — 3–5 outcomes, not a wishlist.
3. **Scope** — paths in / paths out.
4. **Hard rules** — safety + **numeric limits** (non-negotiable).
5. **Process** — short ordered steps.
6. **Required handoff** — `.gojo/handoff.json` (schemaVersion 1) with **what / why / value** (see below).

### Hard rules checklist

- Who owns Git? (Usually: agent does **not** push/merge; gojo `pull-request` / `commit-only` does — unless the task is explicitly a babysitter.)
- No secrets, no weakening CI, no inventing features.
- Stay in the worktree.
- **Explicit caps** (files, packages, tests, PRs, themes).
- What to do when unfinished work remains (`recommendedNextActions`).

## Handoff drives the pull request

When `integration.mode` is `pull-request`, **gojo** runs `gh pr create` — the agent must not. The PR title and body are built from `.gojo/handoff.json`:

| Handoff field | PR use |
| --- | --- |
| `summary` (first line) | PR title (truncated) |
| `summary` (full) | Opening “Summary” section — must include **what**, **why**, and **value** |
| `decisions` | Decisions section (rationale, not only outcomes) |
| `filesChanged` | Files changed |
| `unresolvedIssues` / `recommendedNextActions` | Follow-ups |

Without a rich handoff, reviewers only see a task name like `maintain-tests`. Prompt the agent to write the PR story into the handoff, not into a manual `gh pr create`.

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
| Runtime | “Stop at limit” | Agent `timeout` |
| Overlap | One theme / one root cause | `concurrency.projectLimit: 1`, `overlapPolicy: skip` |
| Bad weeks | Deferred list in handoff | `failurePolicy` + optional `selfHeal` |
| Integration | Who may push/merge | `integration.mode` |

See [Advanced usage](/advanced-usage) for concurrency, approvals, and [Self-healing](/self-healing) for healers (healers need the same one-root-cause limit).

## Dogfood reference

This repository’s scheduled maintenance prompts under [`.gojo/tasks/`](https://github.com/detroitpro/gojo/tree/main/.gojo/tasks) use the table above. Copy the pattern; tighten further for riskier repos.

## Related

- [Advanced agent](/advanced-agent) — full dependency-maintenance prompt example
- [Advanced usage](/advanced-usage) — multi-role agents and operating hygiene
- [Concepts](/concepts) — why the platform owns success and merge
- [Settings](/settings) — task and schedule fields
