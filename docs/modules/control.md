# Module: control

**Path:** `src/control/`

## Responsibility

Control owns durable approval policy and platform-authorized source mutations.
It separates agent judgment from merge authority:

- `ApprovalService` records checks, reviewer verdicts, autonomy, repair rounds,
  operator decisions, escalation, and terminal application state.
- `ControlIntent` is the idempotent audit record for approve, reject, hold, and
  claim requests from UI, CLI, API, forge comments, or chat.
- `MergeService` resolves the source credential, re-reads live checks, and
  serializes the source adapter merge operation.
- `CommentIntentService` polls GitHub, GitLab, or Forgejo PR comments
  incrementally and accepts exact `/gojo approve|merge|hold|reject` commands only
  from trusted actors.

No coding or reviewer agent receives a forge write token. Reviewer handoff
schema v3 supplies judgment (`pass`, `changes-requested`, `reject`) and bounded
label/comment requests; the platform validates and executes those requests.

## State flow

An agent-created PR starts `pending-review`. Settled red checks enter a repair
round or escalate. Settled green checks enqueue the configured independent
reviewer. A passing verdict either applies immediately under reviewer/auto
authority or enters `awaiting-human` under manual authority. Merge revalidates
live checks; failures remain durable with evidence and never silently drop.

Autonomy is **snapshotted** when the PR opens from `integration.approval`.
Changing the agent manifest later does not rewrite open rows — use
`gojo approval set-autonomy <id> <manual|reviewer|auto>` (or
`POST /api/v1/approvals/:id/autonomy`) to catch up; when checks are green and
review is `pass`, reviewer/auto re-advances into merge.

Repair runs are fresh short-lived runs attached to the same remote PR branch.
The approval row temporarily detaches from the old integration while a repair
is queued, then follows the new run so stale polling cannot double-enqueue a
round. Approvals left `awaiting-human` after a fix-round subject/branch gate
failure (including the legacy escalate string) are retried once on the next
reconcile tick when `resumeBranch` is still present
(`evidence.fixRoundStallRetried`).

## Boundaries

- Sources own provider translation and token-backed API calls.
- Runs own worktrees, validation, PR creation, and subject snapshots.
- Control owns authority, decisions, repair count, and merge dispatch.
- Notifications report `awaiting-human`; they cannot change approval state.
- UI, CLI, API, and comments must all submit through `ApprovalService`.

See [PRD §11](../../PRD.md#11-git-and-workstream-strategy) and
[PRD §16](../../PRD.md#16-web-application).
