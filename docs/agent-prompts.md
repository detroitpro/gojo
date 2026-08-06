# Agent prompts (engineering)

User-facing guide: [`site/src/pages/agent-prompts.md`](../site/src/pages/agent-prompts.md).

## Dogfood convention

Scheduled prompts under [`.gojo/agents/`](../.gojo/agents/) pair with shared [`.gojo/instructions.md`](../.gojo/instructions.md) via `instructions` in [`gojo.yaml`](../gojo.yaml).

- **Shared file** — code qualities, operating defaults, handoff judgment (what/why/value).
- **Agent file** — role, goals, scope, numeric **Hard rules**, process; optional short **How you think** heuristics.
- Start tight on limits; widen only after a schedule is trusted.
- **Keys:** agent (and schedule) YAML map keys are durable identities — do **not** encode cadence (`daily` / `weekly` / `nightly`). Put frequency only in `cron` / `timezone`. Prefer schedule key = agent key when there is one schedule per agent. Sync soft-disables removed/renamed schedule names (same as agents).

Platform timeouts and `concurrency` do not replace prompt caps — they stop the process; limits keep the diff reviewable.

When changing a maintenance prompt, keep the limit line explicit and require leftovers in `recommendedNextActions`.

Report-only forge agents (no `integration` block): dogfood agent `maintain-issue-tags` with taxonomy in [`.gojo/labels.md`](../.gojo/labels.md). User-facing write-up: [`site/src/pages/agent-prompts.md`](../site/src/pages/agent-prompts.md) (section *Report-only agents*).

Digest agents ([`.gojo/agents/activity-digest.md`](../.gojo/agents/activity-digest.md)) are report-only plus agent-level `notifications`: handoff `summary` ships verbatim as the message body, so the prompt must specify the finished text. Require per-merge reading (`gh pr view --json title,body,files` / `tea --fields body`) and entries that name the surface that moved, the mechanism, then the effect — a prompt that asks for activity returns titles, and one that asks only for impact returns adjectives. **Every merge gets an equal entry**; no maintenance bucket and no group collapsed to a count. Same prompt shape across all four fleet repos; keep them in step when one changes.

## Runtime assembly

Coordinator builds adapter prompts as: `scheduledRunNotice` → `instructions.files` (worktree) → `promptFile` → validation section → progress-reporting contract (when the run has an API token). Shell adapters skip instructions. The progress block is **platform-injected for every project** (`title` = current focus, not work identity); project `.gojo/instructions.md` is only per-repo shared guidance via the manifest. See [`src/contexts/execution/domain/prompt-assembly.ts`](../src/contexts/execution/domain/prompt-assembly.ts) and [`docs/modules/runs.md`](modules/runs.md).

## Canonical verify (validation ↔ CI)

Each project surface should expose **one locally-runnable check command** (`yarn verify`, `make verify-*`, or `scripts/verify-*.sh`). Both the CI pipeline and `validationProfiles` in `gojo.yaml` invoke that same command so “what gojo checks before opening a PR” cannot drift from “what CI requires.”

- PR-opening agents: profile = surface verify + `handoff-exists`.
- Report-only agents: handoff-only (or artifact checks) is enough.
- Steps that need CI-only services (live DB migrate, Docker, secrets) stay in CI; the repair-round loop (`subject.feedback` + fix rounds) is the backstop for those.
- Dogfood reference: gojo’s own [`scripts/ci-check.sh`](../scripts/ci-check.sh) is used by CI and the `full-check` validation profile.
- Validation steps are injected into the adapter prompt as the definition of done — agents should run them and fix failures before writing the handoff.

## Handoff → PR body

`pull-request` integration opens a PR via [`src/contexts/execution/infrastructure/integration/integrator.ts`](../src/contexts/execution/infrastructure/integration/integrator.ts) using [`buildPrDescription`](../src/contexts/execution/infrastructure/integration/pr-description.ts) and the agent’s `integration.prTool` (`gh` or `tea`; default `gh`). Adapters must not run the PR CLI themselves; they write `.gojo/handoff.json`.

- Short `summary` (title material) and `decisions` for the structured fallback body.
- For verbose PR descriptions, add `assets` with `role: "pr-body"` and a workspace-relative `path` (e.g. `.gojo/assets/pr-body.md`), and optionally `role: "pr-title"`. gojo prefers those assets when creating the PR and copies them under `$GOJO_HOME/artifacts/<runId>/assets/`.

Coordinator passes title/body into `gh pr create` or `tea pulls create` (with optional `prLogin` / `prRemote` for tea).

The handoff and its assets are run output, not repository content — the integrator excludes them from the result commit. See [Repository files](./repo-files.md) for the full committed-vs-generated contract.

## Handoff schema v3 (`subjectActions`)

`normalizeAgentHandoff` / `recoverAgentHandoffReport` accept schema v1–v3 ([`packages/contracts/src/handoff.ts`](../packages/contracts/src/handoff.ts)). v3 adds optional `subjectActions` (`addLabels`, `removeLabels`, `comment`, `verdict`) for issue-driven triage/review agents: the platform validates and applies forge mutations with managed credentials instead of injecting write tokens into adapter processes.

Review/merge policy uses `recoverAgentHandoffReport`: invalid optional `impact` / `assets` / `prUrl` are dropped so a valid `subjectActions.verdict` still applies (invented impact categories must not escalate a passed review). Golden example: [`.gojo/examples/handoff.review.v3.json`](../.gojo/examples/handoff.review.v3.json). Cursor skill: [`.cursor/skills/gojo-handoff/SKILL.md`](../.cursor/skills/gojo-handoff/SKILL.md).

User-facing guide: [`site/src/pages/agent-prompts.md`](../site/src/pages/agent-prompts.md) and [`site/src/pages/issue-driven-agents.md`](../site/src/pages/issue-driven-agents.md).
