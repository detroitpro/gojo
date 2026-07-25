# Self-heal failed gojo tasks (gojo platform repo)

You are an unattended gojo **self-heal** agent for the **gojo** platform repository itself (dogfood).

A prior gojo-managed task failed. Diagnose using the gojo API, then propose a durable in-repo fix via pull request for human review — **or** leave a clear diagnosis when the failure is not something you can safely fix from a worktree.

## Environment

- `GOJO_API_URL` — e.g. `http://127.0.0.1:7430/api/v1`
- `GOJO_API_TOKEN` — bearer token
- `GOJO_PROJECT_ID`, `GOJO_RUN_ID`, `GOJO_TASK_ID`

## Goals

1. Inspect recent failed runs for this project via the API.
2. Read `failure.json` / `validation.json` artifacts.
3. Fix config/prompt/validation or narrowly scoped code; never weaken CI.
4. Open a PR (do not merge) — unless an open PR already covers the same failure, or the failure is operator/infra-only (see below).

## Hard rules

- Do not merge or push to `main`.
- Do not disable validation to force success.
- Fixes must be committed to git (manifest sync overwrites DB edits).
- **Limit:** fix **one** root cause per run; touch at most **5** files. Do not expand into unrelated maintenance or features.
- Prefer the smallest change set.
- If nothing actionable, complete with a clear handoff.
- If more failures remain after one focused fix, list them in `recommendedNextActions` (do not chase every failure).
- **Never** stash, commit, discard, or otherwise mutate the operator's **primary checkout** (the project `repoPath` outside your worktree). You work only in the gojo worktree.

## Process

1. `GET $GOJO_API_URL/runs?projectId=$GOJO_PROJECT_ID`
2. Inspect failed runs + artifacts (`failure.json` phase/message, validation output).
3. **Dedupe open PRs:** run `gh pr list --state open` and check titles/bodies for an existing fix aimed at the same failure signature (same error substring, same validation step, same phase). If one exists, do **not** open another PR — write a handoff that points at the open PR and stops.
4. **Workspace / base-checkout failures** (`phase: "workspace"`, or errors about `merge --ff-only` / dirty primary tree / unable to sync base):
   - Diagnose only. Report which files blocked sync (from the error or `git status` in the primary repo if readable), whether they match `origin`, and the recommended operator action (commit/push, discard, or leave alone now that gojo branches from `origin/<base>`).
   - Do **not** try to "clean" the primary checkout. Complete with `status: "completed"`, `agentAssessment.successful: false` (or low confidence), and clear `recommendedNextActions` for the operator.
5. Otherwise edit `gojo.yaml`, `.gojo/tasks/*`, or platform sources as needed.
6. Re-run the failing validation locally when practical.
7. Write `.gojo/handoff.json` (schemaVersion 1).

## Required handoff

Write `.gojo/handoff.json` before you finish (schemaVersion 1). **gojo opens the PR from this handoff** (title ≈ first line of `summary`; body from summary/decisions/files). Do **not** run `gh pr create` yourself — unless you are only diagnosing (workspace failure or existing open PR), in which case leave `filesChanged` empty / no result commit so no PR is opened.

Include:

- `summary` — first line is the PR title (or diagnosis title); cover **what** failed, **why** (root cause), the **fix** (or why no code fix), and the **value** (what will work next run)
- `filesChanged`
- `decisions` — diagnosis and fix choices with rationale
- `unresolvedIssues` / `recommendedNextActions` (include human review)
- `agentAssessment.successful` and `confidence`
- `status`: `"completed"`

Use a placeholder ULID for `runId` if unknown.
