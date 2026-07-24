---
name: gojo-tdd-daemon
description: >-
  Enforces test-driven development and high coverage for the gojo daemon under
  src/ and tests/. Use when changing TypeScript in src/, adding features or
  bugfixes to the CLI/API/scheduler/adapters, or when the user mentions TDD,
  coverage, or daemon tests.
---

# gojo TDD (daemon)

## Instructions

1. **Red** — Write or update a failing test under `tests/` that specifies the behavior.
2. **Green** — Implement the minimum `src/` change to pass.
3. **Refactor** — Clean up with tests still green.
4. **Coverage** — New or changed daemon code must be covered. Aim for **100% on modules you touch**. Do not delete or weaken assertions to inflate coverage.
5. Run focused tests while iterating; finish with **`make check`** before PR.

## Layout

| Path | Role |
|------|------|
| `src/` | Daemon runtime (CLI, API, scheduler, adapters, storage, …) |
| `tests/unit/` | Fast unit tests |
| `tests/integration/` | Cross-module / process-style tests |

Use the `@/*` import alias (see root `tsconfig.json`).

## Do not

- Ship uncovered branches in files you edited “to finish later”
- Lower `coverage-baseline.json` without an explicit user request
- Put product policy essays in tests — link `docs/` / `PRD.md` when needed
