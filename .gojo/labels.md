# GitHub issue label taxonomy (gojo)

Owned by the `maintain-issue-tags` task. Reconcile the remote label set to this file; do not invent labels outside it.

**No gojo worker task currently selects work by labels.** Reserved `gojo:*` labels exist so future agents can claim issues safely.

## Axes

| Axis | Purpose | Cardinality |
|------|---------|-------------|
| Type | What kind of issue | Exactly one when clear (`bug`, `enhancement`, `documentation`, `question`) |
| `area:*` | Where the change lives | Prefer one primary; second only if truly cross-cutting |
| `domain:*` | Product/module concern | 0–2 |
| `gojo:*` | Automation routing | See rules below |

## Type labels (keep GitHub defaults)

Managed type vocabulary for new work: `bug`, `enhancement`, `documentation`, `question`.

Also leave alone: `duplicate`, `good first issue`, `help wanted`, `invalid`, `wontfix`.

## `area:*` (create + apply)

| Label | Paths | Future worker affinity |
|-------|-------|------------------------|
| `area:daemon` | `src/` (bulk; not cli/api-only) | `maintain-quality`, `maintain-tests` |
| `area:cli` | `src/cli/` | quality/tests when CLI-scoped |
| `area:api` | `src/api/` | quality/tests when API-scoped |
| `area:web` | `web/` | — |
| `area:site` | `site/` | `maintain-docs` |
| `area:docs` | `docs/`, eng-facing README | `maintain-docs` |
| `area:tests` | `tests/` | `maintain-tests` |
| `area:ci` | `.github/`, `scripts/`, Makefile check paths | `maintain-deps` / quality |
| `area:packages` | `packages/` | deps/quality |
| `area:theme` | `theme/` | docs/site-adjacent |
| `area:gojo` | `gojo.yaml`, `.gojo/` | `self-heal`, tag agent |

Colors (suggested): areas `#0E8A16`, domains `#1D76DB`, gojo routing `#B60205`.

## `domain:*` (create + apply)

| Label | Concern |
|-------|---------|
| `domain:runs` | Coordinator, dispatcher, heal, impact, prompt assembly |
| `domain:scheduler` | Cron, overlap, enqueue |
| `domain:agents` | Adapters, handoff |
| `domain:integration` | Commit/PR/merge, PR reconcile |
| `domain:validation` | Validation profiles |
| `domain:workspace` | Worktrees |
| `domain:git` | Git helpers |
| `domain:storage` | SQLite / repositories |
| `domain:auth` | Users / tokens |
| `domain:secrets` | Encrypted secrets |
| `domain:notifications` | Slack / webhooks / Telegram |
| `domain:backup` | Backup / restore |
| `domain:service` | systemd / launchd |
| `domain:diagnostics` | Doctor |
| `domain:manifest` | `gojo.yaml` / manifest sync |
| `domain:telemetry` | OTEL |
| `domain:ux` | Admin UI product surfaces (`area:web`) |

Skip domain labels for pure docs/CI with no module focus.

## `gojo:*` routing (create; apply carefully)

| Label | Meaning | Tag agent may set? |
|-------|---------|--------------------|
| `gojo:needs-triage` | Missing/unclear area or domain after best effort | Yes |
| `gojo:ready` | Cleared for automation to claim | **No** (human or future triage only) |
| `gojo:blocked` | Do not automate | **No** (human only) |

### Future routing contract (not wired into workers yet)

A code agent may consider an issue only when it has **`gojo:ready`** and an **`area:*`** matching its slice (e.g. `maintain-quality` → `area:daemon` / `area:api` / `area:cli`). Domain labels refine scope; they do not alone authorize work.

## Forbidden / do not create

Do not add overlapping type aliases (`feature`, `idea`) or one-off `phase:*` milestones unless product explicitly adopts them in this file.

## Apply rules (tag agent)

1. Ensure every managed `area:*`, `domain:*`, and `gojo:*` label exists on the repo.
2. Scan open issues (respect task cap). Add/correct `area:*` + `domain:*` from title/body/paths.
3. If type is missing and clearly bug vs docs vs enhancement, add exactly one of `bug` | `documentation` | `enhancement`.
4. Set `gojo:needs-triage` when classification is uncertain; clear it when area/domain are set confidently.
5. Never set or clear `gojo:ready` / `gojo:blocked`.
6. Never invent labels outside this file.
