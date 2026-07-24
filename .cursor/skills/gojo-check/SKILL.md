---
name: gojo-check
description: >-
  Runs the gojo repository CI quality gate via make check before PRs or claiming
  work is done. Use when finishing a change, opening a PR, pushing to main, or
  when the user mentions check, CI, pre-PR, or make check.
---

# gojo check

## Instructions

1. From the repo root, run **`make check`** (same as `bun run check` / CI).
2. Do not skip steps or use a weaker substitute (`bun test` alone is not enough).
3. If anything fails, fix it and re-run `make check` until green.
4. Only then open a PR, push, or say the work is complete.

## What `make check` covers

Delegates to `scripts/ci-check.sh`:

- Daemon `typecheck`
- Daemon `bun test --coverage` with **line coverage ≥** `coverage-baseline.json`
- Web typecheck + build
- Site Astro build
- Compile `bin/gojo`

## Notes

- Prefer fixing root causes over lowering the coverage baseline.
- Ratchet `coverage-baseline.json` upward when overall coverage meaningfully improves.
