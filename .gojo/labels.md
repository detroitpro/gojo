# GitHub issue label taxonomy (gojo)

Owned by the `maintain-issue-tags` agent. Reconcile the remote label set to this file; do not invent labels outside it.

Issue-driven agents use the `gojo:*` state machine below.

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
| `gojo:ready` | Trusted actor authorizes triage | **No** (human only) |
| `gojo:validated` | Triage confirmed an actionable brief | **No** (triage agent only) |
| `gojo:in-progress` | Platform holds an active claim | **No** (platform only) |
| `gojo:blocked` | Missing detail, failed run, or human stop | **No** (triage/platform/human) |
| `gojo:auto-merge` | Reviewer pass may authorize platform merge | **No** (human only) |

### Routing contract

`issue-triage` claims trusted `gojo:ready` issues. `issue-implement` requires
both `gojo:ready` and `gojo:validated`. Gojo applies `gojo:in-progress`
atomically with the claim and removes/releases it through validated handoff
actions. `gojo:auto-merge` changes authority, never the green-check or
independent-review requirements.

## Forbidden / do not create

Do not add overlapping type aliases (`feature`, `idea`) or one-off `phase:*` milestones unless product explicitly adopts them in this file.

## Apply rules (tag agent)

1. Ensure every managed `area:*`, `domain:*`, and `gojo:*` label exists on the repo.
2. Scan open issues (respect task cap). Add/correct `area:*` + `domain:*` from title/body/paths.
3. If type is missing and clearly bug vs docs vs enhancement, add exactly one of `bug` | `documentation` | `enhancement`.
4. Set `gojo:needs-triage` when classification is uncertain; clear it when area/domain are set confidently.
5. Never set or clear `gojo:ready`, `gojo:validated`, `gojo:in-progress`,
   `gojo:blocked`, or `gojo:auto-merge`.
6. Never invent labels outside this file.
