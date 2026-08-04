# Behavior-lock contract tests

Outside-in characterization suites for the architecture evolution plan.
These assert the **stable surface** (HTTP API, CLI, run pipeline, admin view mounts).

## Rules

1. Later refactor phases must keep these green **without editing them** to weaken assertions.
2. Prefer adding new characterization cases over changing existing ones.
3. When intentional product behavior changes, update the contract in the same PR and call it out.

## Layout

| Path | Locks |
|------|--------|
| `api/` | HTTP status/error codes and response envelopes |
| `cli/` | CLI exit codes, JSON stdout, and resulting DB side effects |
| `pipeline/` | End-to-end shell agent → Succeeded (commit-only) via API |
| `support/` | Shared harnesses for API/CLI boots |

Frontend mount smoke lives in `web/tests/views-smoke.vitest.ts` (Vitest).
