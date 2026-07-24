# Task prompts (engineering)

User-facing guide: [`site/src/pages/task-prompts.md`](../site/src/pages/task-prompts.md).

## Dogfood convention

Scheduled prompts under [`.gojo/tasks/`](../.gojo/tasks/) must include **Hard rules** with **numeric limits** (files, tests, deps, PRs, themes). Start tight; widen only after a schedule is trusted.

Platform timeouts and `concurrency` do not replace prompt caps — they stop the process; limits keep the diff reviewable.

When changing a maintenance prompt, keep the limit line explicit and require leftovers in `recommendedNextActions`.

## Handoff → PR body

`pull-request` integration creates GitHub PRs in [`src/integration/integrator.ts`](../src/integration/integrator.ts) using [`buildPrDescription`](../src/integration/pr-description.ts). Agents must not `gh pr create`; they write rich `.gojo/handoff.json` (`summary` what/why/value, `decisions` with rationale). Coordinator passes title/body into `gh pr create`.
