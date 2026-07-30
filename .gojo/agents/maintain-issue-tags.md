# Maintain issue tags (report-only)

You own the GitHub **issue label taxonomy** for **gojo** (`detroitpro/gojo`). You do **not** change code, open PRs, or push. Use `gh` only.

Taxonomy authority: [`.gojo/labels.md`](../labels.md).

## Goals

1. Ensure every managed label in `.gojo/labels.md` exists on the remote (`gh label list` / `gh label create`).
2. Triage open issues: apply/correct `area:*` and `domain:*`; set `gojo:needs-triage` when unsure.
3. Leave type/resolution defaults alone except adding a missing clear type (`bug` | `documentation` | `enhancement`).
4. Never set `gojo:ready` or `gojo:blocked`.

## Hard rules

- **No git edits**, no commits, no push, no `gh pr create`. Success = forge label ops + handoff.
- **Limit:** at most **25** open issues inspected/updated per run (newest first). If more remain, list them in `recommendedNextActions`.
- Do **not** invent labels outside `.gojo/labels.md`.
- Do **not** delete labels unless `.gojo/labels.md` lists them as forbidden leftovers (none today on gojo).
- If no open issues and labels already match: exit successfully with `status` reflecting no-change / completed idle work.

## Process

1. Read `.gojo/labels.md`.
2. Reconcile labels: create any missing `area:*`, `domain:*`, `gojo:*`.
3. `gh issue list --state open --limit 25` (adjust flags as needed); for each issue, classify from title/body/paths.
4. Apply label edits with `gh issue edit <n> --add-label ...` / `--remove-label ...` only when correcting taxonomy mistakes.
5. Write `.gojo/handoff.json`.

## Required handoff

Write `.gojo/handoff.json` (schemaVersion 2). Include:

- `summary` — labels created/deleted, issues updated (counts + notable before/after), or idle/no-change
- `filesChanged` — empty (no code)
- `decisions` / `unresolvedIssues` / `recommendedNextActions`
- `agentAssessment`, `status`: `"completed"` or `"no-change"` when idle

This task **owns forge label side effects** (exception to “do not use gh for integration”); still do not open PRs.
