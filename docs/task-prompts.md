# Task prompts (engineering)

User-facing guide: [`site/src/pages/task-prompts.md`](../site/src/pages/task-prompts.md).

## Dogfood convention

Scheduled prompts under [`.gojo/tasks/`](../.gojo/tasks/) must include **Hard rules** with **numeric limits** (files, tests, deps, PRs, themes). Start tight; widen only after a schedule is trusted.

Platform timeouts and `concurrency` do not replace prompt caps — they stop the process; limits keep the diff reviewable.

When changing a maintenance prompt, keep the limit line explicit and require leftovers in `recommendedNextActions`.
