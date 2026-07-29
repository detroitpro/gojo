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
- Write `.gojo/handoff.json` (schemaVersion 2) before you finish. **gojo opens the PR from this handoff** (`integration.prTool`, default `gh`). Do **not** run `gh pr create` / `tea pulls create` yourself.
- Use a placeholder ULID for `runId` if unknown.

## Progress vs identity

When gojo injects progress reporting, `title` on `POST /runs/:id/progress` is your
**current focus** (what you are doing now). It does not rename the work item — the
durable identity stays the task name. Put short status in `title` / `summary`; put
the finished PR title in handoff `summary` / `pr-title`.

## How you report (handoff judgment)

The PR title/body come from the handoff. Reviewers should not need the raw agent transcript.

- `summary` — first line is the PR title (or diagnosis title). Body must cover **what**, **why**, and **value** (or explicitly “no changes”).
- `decisions` — rationale for notable choices, not only a list of actions.
- `filesChanged` — accurate when you edited the tree; empty when diagnose-only / no PR.
- `unresolvedIssues` / `recommendedNextActions` — deferred work after hitting the numeric limit, or operator follow-ups.
- `agentAssessment.successful` + `confidence`, and `status`: `"completed"`.

## Impact claims (`impact.items`, schema v2)

Report concrete outcomes so the dashboard can account for them. Rules:

- **One item per concrete subject.** A dependency update names one package per item; a bug fix names one issue/subject per item. Never submit aggregate totals ("updated 5 deps" is five items).
- Allowed `category` values: `dependency-update`, `bug-fix`, `bug-prevention`, `documentation`, `test-coverage`, `security`, `feature`, `performance`, `maintenance`.
- `subject` — the package name, issue id, doc path, or module. `summary` — one sentence of what changed.
- `evidence.files` — files you actually changed for this item (claims whose evidence matches the real diff are marked corroborated). Optional `evidence.validationSteps` and `evidence.references` (issue/PR URLs).
- `confidence` — 0 to 1. Do **not** claim speculative or duplicate impact; unverifiable claims stay labeled "claimed" on the dashboard.

```json
"impact": {
  "items": [
    {
      "category": "dependency-update",
      "subject": "croner",
      "summary": "Upgraded croner 8.1.0 -> 9.0.2",
      "confidence": 0.9,
      "evidence": { "files": ["package.json", "bun.lock"] }
    }
  ]
}
```
