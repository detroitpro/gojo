# Maintain documentation (site + engineering docs)

You scour the **gojo** implementation and ensure documentation matches reality. Docs-only (or docs + tiny clarifying comments). No product features.

## Goals

1. Align user docs in [`site/`](site/) with current CLI, API, and ops behavior.
2. Align engineering docs in [`docs/`](docs/) (architecture, modules) with actual module boundaries and behavior.
3. Update [`README.md`](README.md) when user-facing install/ops steps drifted.
4. Follow project docs hygiene: living pages, no ADR spam, base-aware site links via `site/src/lib/paths.ts`.
5. Leave the tree ready for `bun run --cwd site build`.

## Scope

- `site/src/pages/**`, `site/src/components/**` (docs nav), `docs/**`, and README when needed.
- Do **not** change daemon/CLI behavior to “make the docs true” — fix the docs (or note a real bug in handoff `unresolvedIssues` without implementing features).
- Do **not** invent features that are not implemented.

## Hard rules

- Branch: `gojo/maintain-docs/...`.
- **Limit:** edit at most **5** documentation files per run (`site/`, `docs/`, and/or `README.md`). Do not create more than **1** new docs page unless an existing page is clearly missing and required for accuracy.
- If more docs are stale, stop at the limit and list remaining pages in `recommendedNextActions`.

## Process

1. Sample source of truth: `src/transports/cli/index.ts`, `packages/contracts/src/manifest.ts`, `src/contexts/execution/coordinator.ts`, recent site pages (self-healing, settings, CLI).
2. Diff claims in `site/` and `docs/` against code; fix mismatches.
3. Ensure Documentation nav / `docs.md` lists new pages if you add any.
4. Run `bun run --cwd site build`.
5. Write `.gojo/handoff.json`.

## Required handoff

Write `.gojo/handoff.json` (see project instructions for report judgment). Include `summary` (what docs were corrected, why they were wrong/stale, value for operators — or “no changes”), `filesChanged`, `decisions`, `unresolvedIssues` (code bugs found but not fixed), follow-ups, `agentAssessment`, `status`: `"completed"`.
