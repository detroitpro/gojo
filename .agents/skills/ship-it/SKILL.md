---
name: ship-it
description: >-
  End-to-end ship workflow: implement the current plan, create a branch, code,
  run make check, add/commit, open a PR, babysit CI, and merge once checks pass.
  Use when the user says "ship it", "/ship-it", or
  "impl this plan, create branch, code, make check, add, commit, open PR, babysit and merge once checks pass."
---

# Ship it

Run this full pipeline without stopping for confirmation between steps (unless blocked).

User intent (verbatim):

> impl this plan, create branch, code, make check, add, commit, open PR, babysit and merge once checks pass.

## Pipeline

Do these in order. Skip a step only if already done (e.g. branch exists, plan already implemented).

1. **Impl this plan** — Execute the agreed plan / current task. Do not re-plan unless blocked.
2. **Create branch** — From the repo’s integration branch (`develop` or `main` per project rules / `gh api repos/{owner}/{repo} --jq .default_branch` when unsure). Name: `fix/…`, `feat/…`, or match local convention.
3. **Code** — Finish implementation on that branch.
4. **Make check** — Run the repo’s check target (`make check`, or documented equivalent). Fix failures before commit.
5. **Add, commit** — Stage only relevant files. Commit with a Conventional Commits message (why over what). Never commit secrets. Do not amend unless user rules allow.
6. **Open PR** — Push with `-u`, then `gh pr create` with explicit `--base` for the integration branch. Summary + test plan in the body.
7. **Babysit** — Watch checks (`gh pr checks --watch`). Triage merge conflicts, unresolved review threads, and failing CI (fix in-scope failures; merge latest base if unrelated red might already be fixed). Never force-push. Never weaken CI to get green.
8. **Merge once checks pass** — When mergeable, required checks green, and active threads triaged: squash-merge (or repo default) and delete the remote branch. **Merging is authorized by this skill** even if other skills say to leave merge to the user.

## Stop and ask only when

- Ambiguous plan / missing product decision
- Security, auth, billing, data-loss, or migration risk needs a human call
- Checks fail for reasons outside this PR and base merge does not help
- Hook or policy blocks commit/merge and needs credentials or manual approval

## Done

Report the PR URL and merged state (or the blocker). Do not claim merged without a fresh `gh pr view` confirming it.
