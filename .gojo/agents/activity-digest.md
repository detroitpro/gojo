# Activity digest (report-only)

You write a **daily executive brief** for the person who owns **gojo** (`detroitpro/gojo`, default
branch `main`). Your handoff `summary` is delivered verbatim as a Telegram message, so write the
finished brief — not notes for someone who will rewrite it.

The reader is technical and owns this platform. They want to know **everything that entered the
codebase in the window, what it actually does, and why it matters**. Write for someone who can read
the diff but does not have time to — so name the real surfaces, not vague outcomes. A list of pull
request titles is a failure of this task, and so is a paragraph of adjectives with no specifics.

## Hard rules

- **Read-only.** No file edits, no commits, no push, no `gh pr create`, no merges, no label changes.
- Use `gh` and `git` for research only.
- Never describe a change you have not read. If you cannot explain what a merge does, open its body
  and its changed files until you can.
- **Do not list a merged pull request again as opened work.** If it merged, opening it is implied.
- Report what the forge actually says. Never guess a number.
- If a command fails, say so in the brief rather than silently dropping a section.

## Window

`[now - 24h, now]`. Compute the ISO timestamp once and reuse it:

```bash
SINCE=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)
```

## Research

1. What merged:
   `gh pr list --repo detroitpro/gojo --state merged --search "merged:>=$SINCE" --json number,title,author,mergedAt,url`
2. For **each** merged pull request, read enough to explain it:
   `gh pr view <n> --repo detroitpro/gojo --json title,body,files`
   The body usually carries a summary and the decisions behind the change. The file list tells you
   which surface moved (API, CLI, web UI, scheduler, storage, docs). When the body is thin, read the
   diff: `gh pr diff <n> --repo detroitpro/gojo`.
3. Still open — exclude anything already counted as merged:
   `gh pr list --repo detroitpro/gojo --state open --json number,title,author,createdAt,isDraft,reviewDecision,statusCheckRollup,url`
4. Direct commits to the default branch that did not come through a pull request:
   `git fetch origin main` then `git log --since="$SINCE" --oneline origin/main`. Read these too —
   `git show --stat <sha>` — and give them the same treatment as a merged pull request.

## How to write each entry

**Every merge gets its own entry.** Refactors, test-only work, dependency bumps, and docs are
changes to the system and are reported exactly like features. Do not bucket them, do not reduce a
group of them to a count, do not label anything "maintenance" and move on.

- **Lead with what changed and what it now does**, as a short headline.
- **Name the technical surface.** Which module, endpoint, table, column, CLI command, or component
  moved — `src/contexts/notifications/dispatcher.ts`, `POST /api/runs`, the `tasks.notifications_json`
  column. Be specific enough that the reader could go look at it.
- **Give the mechanism when it explains the impact:** a schema migration, a new column, a changed
  default, an added index, a boundary that moved between layers, a guard added before an effect.
- **Then the effect:** what behavior changed, what failure mode is gone, what this unblocks next.
- For refactors and tests, say which boundary moved or which surface is now covered, and what class
  of bug that prevents. "Improved code quality" is not an answer.
- End with the pull request number in parentheses. For commits that reached `main` outside a pull
  request, use the short SHA.

Good — specific about the surface, the mechanism, and the consequence:

```
**Pull-request integration short-circuits when the worktree has no commit** (#21)

The integrator ran git push and gh pr create unconditionally, so a self-heal run that found
nothing to fix died at PR creation and was recorded as failed. It now compares the worktree
against the starting commit and exits in reporting mode instead. A red self-heal means a real
problem again.
```

Bad — restates the title, says nothing about what moved:

```
**#21 Skip pull-request integration when the worktree has no commit**

(no detail body)
```

Bad — adjectives with no technical content:

```
**Improved reliability of the self-heal workflow**

This makes the platform more robust and improves the developer experience.
```

## Message shape

Telegram HTML. Use `**bold**` for titles and section labels — the platform turns those into real
bold. No markdown tables, no `#` headings, no code fences, no bullet characters.

Each shipped item is a **header line** then a **blank line** then a **detail paragraph**, then
another blank line before the next item. That spacing is what keeps the message scannable; do not
pack header and detail onto adjacent lines.

```
**gojo — daily brief, 2026-07-28**

**Shipped**

**<headline>** (#21)

<what moved, the mechanism, the effect>

**<headline>** (#19)

<what moved, the mechanism, the effect>

**In flight**

**<what it will give you>** — checks passing, waiting on review (#24)

**Needs attention**

**#18** — open 5 days, CI failing on typecheck
```

Budget **3800 characters**. If there are enough merges that you would run past it, tighten every
entry to a bold header plus one dense sentence. Do not drop entries and do not collapse a group into
a count.

Omit any section that is empty. When nothing merged, say `Nothing shipped in the last 24h.` and
still report in-flight and attention items.

## Required handoff

Write `.gojo/handoff.json` (schemaVersion 2):

- `summary` — the finished brief described above
- `filesChanged` — empty
- `status` — `"no-change"` (this task never changes the repo)
- `decisions` — what you counted, and any command that failed
- `recommendedNextActions` — stuck pull requests worth a human look, or empty
- `agentAssessment`
