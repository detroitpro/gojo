# Task prompts (engineering)

User-facing guide: [`site/src/pages/task-prompts.md`](../site/src/pages/task-prompts.md).

## Dogfood convention

Scheduled prompts under [`.gojo/tasks/`](../.gojo/tasks/) pair with shared [`.gojo/instructions.md`](../.gojo/instructions.md) via `instructions` in [`gojo.yaml`](../gojo.yaml).

- **Shared file** — code qualities, operating defaults, handoff judgment (what/why/value).
- **Task file** — role, goals, scope, numeric **Hard rules**, process; optional short **How you think** heuristics.
- Start tight on limits; widen only after a schedule is trusted.
- **Keys:** task (and schedule) YAML map keys are durable identities — do **not** encode cadence (`daily` / `weekly` / `nightly`). Put frequency only in `cron` / `timezone`. Prefer schedule key = task key when there is one schedule per task. Sync soft-disables removed/renamed schedule names (same as tasks).

Platform timeouts and `concurrency` do not replace prompt caps — they stop the process; limits keep the diff reviewable.

When changing a maintenance prompt, keep the limit line explicit and require leftovers in `recommendedNextActions`.

Report-only forge agents (no `integration` block): dogfood task `maintain-issue-tags` with taxonomy in [`.gojo/labels.md`](../.gojo/labels.md). User-facing write-up: [`site/src/pages/task-prompts.md`](../site/src/pages/task-prompts.md) (section *Report-only agents*).

## Runtime assembly

Coordinator builds AI adapter prompts as: `scheduledRunNotice` → `instructions.files` (worktree) → `promptFile` → validation section. Shell adapters skip instructions. See [`src/runs/prompt-assembly.ts`](../src/runs/prompt-assembly.ts) and [`docs/modules/runs.md`](modules/runs.md).

## Handoff → PR body

`pull-request` integration opens a PR via [`src/integration/integrator.ts`](../src/integration/integrator.ts) using [`buildPrDescription`](../src/integration/pr-description.ts) and the task’s `integration.prTool` (`gh` or `tea`; default `gh`). Agents must not run the PR CLI themselves; they write `.gojo/handoff.json`.

- Short `summary` (title material) and `decisions` for the structured fallback body.
- For verbose PR descriptions, add `assets` with `role: "pr-body"` and a workspace-relative `path` (e.g. `.gojo/assets/pr-body.md`), and optionally `role: "pr-title"`. gojo prefers those assets when creating the PR and copies them under `$GOJO_HOME/artifacts/<runId>/assets/`.

Coordinator passes title/body into `gh pr create` or `tea pulls create` (with optional `prLogin` / `prRemote` for tea).
