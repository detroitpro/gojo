---
layout: ../layouts/DocLayout.astro
title: Concepts
description: How gojo thinks about agents, success, worktrees, runs, and handoffs.
---

## The agent is not the authority on success

An agent may say it finished. gojo only marks a run successful when the configured contract is met: process exit, structured report (when required), repository inspection, validation commands, and integration outcome.

That split is what turns “scheduled agent CLI” into an operations platform.

## Agents don’t own the target branch

Each attempt works in an isolated **branch + Git worktree**. The platform owns:

- Branch and worktree creation
- Commit verification
- Merge serialization
- Conflict detection
- Pull request creation (when configured)

This prevents two concurrent agents from racing into `main`.

## Runs and attempts

- A **run** is one logical execution of a task (manual, schedule, or API).
- An **attempt** is a single agent invocation. Retries add attempts; history is kept.

Typical happy path:

```text
Scheduled → Queued → Preparing → Running → Validating
  → (AwaitingApproval?) → Integrating → Reporting → Succeeded
```

Other terminals include Failed, Canceled, TimedOut, Conflict, Skipped, and InfrastructureFailure.

## Worktrees

Worktrees give each attempt a dedicated filesystem directory linked to the same repo object database. No two active attempts share a worktree. Failed worktrees can be retained briefly for diagnosis; successful ones are cleaned up according to policy.

## Handoff reports

When a run finishes, gojo stores a structured handoff (from the agent’s `.gojo/handoff.json` and/or platform summary): files changed, decisions, unresolved issues, recommended next actions. Future agents should consume that summary — not a raw dump of every prior transcript.

## Idempotency and recovery

Schedule triggers use idempotency keys so a restart doesn’t double-create the same fire. After a crash, non-terminal runs are reconciled (process still alive? commit present? abandon vs resume) instead of being silently marked successful.

## Local-first control plane

One gojo process holds the scheduler lease for a database. CLI, HTTP API, embedded ops UI, and notifications all share that instance. Agent CLIs remain separate installs invoked through adapters.

## Related

- [Your first agent](/first-agent) — see the lifecycle in practice
- [Settings](/settings) — knobs that implement these rules
