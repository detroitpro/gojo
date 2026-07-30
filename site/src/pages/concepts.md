---
layout: ../layouts/DocLayout.astro
title: Concepts
description: How gojo thinks about adapters, agents, success, worktrees, runs, and handoffs.
---

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Adapter** | An installed coding-agent CLI (shell / cursor / claude-code). Surfaced under **Adapters** in the UI and `gojo adapter …`. |
| **Profile** | A reusable adapter configuration in `profiles:` (timeout, model, permissions). |
| **Agent** | A work-unit definition in `agents:` (prompt, validation, integration, failure policy). |
| **Run** | One logical execution of an agent. |
| **Attempt** | A single adapter invocation inside a run. |

## The adapter is not the authority on success

An adapter may say the agent finished. gojo only marks a run successful when the configured contract is met: process exit, structured report (when required), repository inspection, validation commands, and integration outcome.

That split is what turns "scheduled agent CLI" into an operations platform.

## Adapters don't own the target branch

Each attempt works in an isolated **branch + Git worktree**. The platform owns:

- Branch and worktree creation
- Commit verification
- Merge serialization
- Conflict detection
- Pull request creation (when configured)

This prevents two concurrent adapter subprocesses from racing into `main`.

## Runs and attempts

- A **run** is one logical execution of an agent (manual, schedule, API, or `heal`).
- An **attempt** is a single adapter invocation. `maxAttemptsPerRun` creates additional attempts under the same run; history is kept.

Typical happy path:

```text
Scheduled → Queued → Preparing → Running → Validating
  → (AwaitingApproval?) → Integrating → Reporting → Succeeded
```

Other terminals include Failed, Canceled, TimedOut, Conflict, Skipped, and InfrastructureFailure.

## Worktrees

Worktrees give each attempt a dedicated filesystem directory linked to the same repo object database. No two active attempts share a worktree. Failed worktrees can be retained briefly for diagnosis; successful ones are cleaned up according to policy.

## Handoff reports

When a run finishes, gojo stores a structured handoff (from the adapter's `.gojo/handoff.json` and/or platform summary): files changed, decisions, unresolved issues, recommended next actions, and (schema v2) `impact.items` for dashboard accounting. Schema v1 remains accepted; prefer v2 for pull-request agents. Future runs should consume that summary — not a raw dump of every prior transcript.

The handoff file is **run output, not repository content**. gojo persists it as a run artifact and excludes it from the commits it creates, along with the shell adapter's generated `.gojo/run.sh`. If a repository committed one of these, every agent branch would rewrite the same path and every merge would leave the remaining open pull requests conflicting. See [what to commit and what to ignore](/first-agent#what-to-commit-and-what-to-ignore).

## Idempotency and recovery

Schedule triggers use idempotency keys so a restart doesn't double-create the same fire. After a crash, non-terminal runs are reconciled (process still alive? commit present? abandon vs resume) instead of being silently marked successful.

## Local-first control plane

One gojo process holds the scheduler lease for a database. CLI, HTTP API, embedded ops UI, and notifications all share that instance. Adapter CLIs remain separate installs invoked through the `agents/` module.

## Related

- [Your first agent](/first-agent) — see the lifecycle in practice
- [Self-healing](/self-healing) — retries, heal triggers, and in-repo fix PRs
- [Settings](/settings) — knobs that implement these rules
