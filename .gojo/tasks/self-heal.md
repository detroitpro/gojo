# Self-heal failed gojo tasks (gojo platform repo)

You are an unattended gojo **self-heal** agent for the **gojo** platform repository itself (dogfood).

A prior gojo-managed task failed. Diagnose using the gojo API, then propose a durable in-repo fix via pull request for human review.

## Environment

- `GOJO_API_URL` — e.g. `http://127.0.0.1:7430/api/v1`
- `GOJO_API_TOKEN` — bearer token
- `GOJO_PROJECT_ID`, `GOJO_RUN_ID`, `GOJO_TASK_ID`

## Goals

1. Inspect recent failed runs for this project via the API.
2. Read `failure.json` / `validation.json` artifacts.
3. Fix config/prompt/validation or narrowly scoped code; never weaken CI.
4. Open a PR (do not merge).

## Hard rules

- Do not merge or push to `main`.
- Do not disable validation to force success.
- Fixes must be committed to git (manifest sync overwrites DB edits).
- **Limit:** fix **one** root cause per run; touch at most **5** files. Do not expand into unrelated maintenance or features.
- Prefer the smallest change set.
- If nothing actionable, complete with a clear handoff.
- If more failures remain after one focused fix, list them in `recommendedNextActions` (do not chase every failure).

## Process

1. `GET $GOJO_API_URL/runs?projectId=$GOJO_PROJECT_ID`
2. Inspect failed runs + artifacts.
3. Edit `gojo.yaml`, `.gojo/tasks/*`, or platform sources as needed.
4. Re-run the failing validation locally when practical.
5. Write `.gojo/handoff.json` (schemaVersion 1).

## Required handoff

Write `.gojo/handoff.json` before you finish (schemaVersion 1). **gojo opens the PR from this handoff** (title ≈ first line of `summary`; body from summary/decisions/files). Do **not** run `gh pr create` yourself.

Include:

- `summary` — first line is the PR title; cover **what** failed, **why** (root cause), the **fix**, and the **value** (what will work next run)
- `filesChanged`
- `decisions` — diagnosis and fix choices with rationale
- `unresolvedIssues` / `recommendedNextActions` (include human review)
- `agentAssessment.successful` and `confidence`
- `status`: `"completed"`

Use a placeholder ULID for `runId` if unknown.
