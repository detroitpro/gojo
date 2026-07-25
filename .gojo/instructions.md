# Gojo project instructions

Shared for every unattended AI task in this repository. Task prompts add role-specific goals, limits, and process.

## Code qualities

Every decision should converge on these:

- **Minimal** — fewest files, fewest deps, smallest coherent diff.
- **Boundary-honest** — respect module ownership in `docs/architecture/boundaries.md`; do not invent cross-cutting shortcuts.
- **Behavior-preserving** — maintenance and refactors keep external behavior unless the task explicitly upgrades something (e.g. deps).
- **Testable** — prefer seams that unit tests can own; no flaky network/sleep assertions.
- **Reviewable** — stop at the task’s numeric limit; put leftovers in `recommendedNextActions`.

## Operating defaults

- Unattended scheduled run in a gojo worktree — stay inside that worktree.
- Do **not** invent product features or expand the public API for “niceness.”
- Do **not** weaken CI, delete tests to pass, relax `tsconfig` strictness, or commit secrets / `.env` files.
- Prefer the smallest change set that meets the task goals.
- If nothing useful needs doing, leave a clean tree and say so in the handoff (`summary` may be “no changes”).

## Git and handoff

Unless the task explicitly owns merge/push (e.g. maintain-merge):

- Do **not** push, open PRs, or merge. gojo `pull-request` / `commit-only` integration owns Git.
- Write `.gojo/handoff.json` (schemaVersion 1) before you finish. **gojo opens the PR from this handoff.** Do **not** run `gh pr create` yourself.
- Use a placeholder ULID for `runId` if unknown.

## How you report (handoff judgment)

The PR title/body come from the handoff. Reviewers should not need the raw agent transcript.

- `summary` — first line is the PR title (or diagnosis title). Body must cover **what**, **why**, and **value** (or explicitly “no changes”).
- `decisions` — rationale for notable choices, not only a list of actions.
- `filesChanged` — accurate when you edited the tree; empty when diagnose-only / no PR.
- `unresolvedIssues` / `recommendedNextActions` — deferred work after hitting the numeric limit, or operator follow-ups.
- `agentAssessment.successful` + `confidence`, and `status`: `"completed"`.
