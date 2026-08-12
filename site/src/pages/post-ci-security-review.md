---
layout: ../layouts/DocLayout.astro
title: Post-CI security review
description: Gate gojo agent pull requests with a dedicated checks-settled security agent — block on findings, suggest or auto-fix via fixRounds.
---

After a gojo agent opens a pull request and source checks settle, you can run a
**dedicated security reviewer agent** before the platform merges. The reviewer
is a normal agent in `gojo.yaml` — the name is not special (it does not have to
be `issue-review`). What matters is the trigger and the handoff verdict.

Use this when nightly or issue-driven implementers should stay automated
(`approval: reviewer`) but must not merge when a security agent finds a problem.

For the full issue → implement → review product flow, see
[Issue-driven agents](/issue-driven-agents). For other autonomy knobs
(`approval: auto`, `prAutoMerge`), see [Advanced usage](/advanced-usage).

## How it works

1. An **implementer** agent opens a PR with `integration.mode: pull-request` and
   `approval: reviewer`.
2. Forge CI runs. Gojo waits on a durable approval (no model process stays up).
3. When checks settle, Gojo enqueues an enabled agent whose trigger is
   `pull-request-checks-settled` and whose `fromAgents` list includes the
   implementer name.
4. That security agent reviews the diff and writes a handoff with exactly one
   `subjectActions.verdict`: `pass`, `changes-requested`, or `reject`.
5. Platform outcome:
   - **`pass`** (+ green checks) → platform merges.
   - **`changes-requested`** → if the implementer still has `fixRounds` left,
     Gojo re-enqueues that implementer for a repair round; otherwise the PR stays
     blocked.
   - **`reject`** → stop; no merge.

`approval: reviewer` means the **reviewer agent’s verdict** authorizes merge —
not that a human must click Approve. Human gates use `approval: manual` (and
can fire `onApprovalNeeded` notifications).

## Suggest vs fix

There is no separate `reviewMode` flag. Approximate suggest vs fix with
**`fixRounds` on the implementer** and the verdict the security agent returns:

| Intent | Implementer YAML | Security agent verdict |
| --- | --- | --- |
| **Fix** (auto repair) | `fixRounds: 2` (or any `N > 0`) | `changes-requested` for remediable findings |
| **Suggest only** (no auto repair) | `fixRounds: 0` | `changes-requested` or `reject`, plus a comment / labels |
| **Hard block** | any | `reject` |

Repair rounds re-run the **implementing** agent (not the security agent) on the
existing PR branch with feedback in the subject snapshot. Bound rounds with
`fixRounds` so a stubborn finding cannot loop forever.

## Example

Minimal project: one nightly quality agent and one security reviewer. Sync after
editing (`gojo project sync <project-id>` or **Projects → Sync**).

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/detroitpro/gojo/main/packages/contracts/schemas/gojo.project.schema.json
version: 1

project:
  name: demo
  defaultBranch: main

repository:
  remote: origin
  syncBeforeRun: true
  requireCleanBase: true
  submodules: false
  gitLfs: false

profiles:
  cursor:
    adapter: cursor
    model: default
    timeout: 45m

validationProfiles:
  unit:
    steps:
      - name: test
        command: make test
        timeout: 15m
      - name: handoff-exists
        command: test -f .gojo/handoff.json
        timeout: 30s
  handoff:
    steps:
      - name: handoff-exists
        command: test -f .gojo/handoff.json
        timeout: 30s

agents:
  maintain-quality:
    description: Small maintainability fixes; open a PR
    profile: cursor
    promptFile: .gojo/agents/maintain-quality.md
    validationProfile: unit
    integration:
      mode: pull-request
      targetBranch: main
      prTool: gh
      approval: reviewer
      # Fix mode: allow up to two automatic repair rounds after security
      # changes-requested. Use fixRounds: 0 for suggest-only (no auto repair).
      fixRounds: 2
      requireAllValidations: true

  security-review:
    description: Post-CI security gate for maintain-quality PRs
    profile: cursor
    promptFile: .gojo/agents/security-review.md
    validationProfile: handoff
    trigger:
      on: pull-request-checks-settled
      fromAgents:
        - maintain-quality
    concurrency:
      projectLimit: 1
      overlapPolicy: skip

schedules:
  maintain-quality:
    agent: maintain-quality
    cron: "0 2 * * *"
    timezone: America/Detroit
```

Point `security-review` at a prompt that:

- Does **not** edit, push, or merge.
- Reviews the full diff for secrets, unsafe defaults, authz gaps, and dependency
  risk (tune the checklist to your stack).
- Returns **exactly one** handoff verdict: `pass`, `changes-requested`, or
  `reject` (schema v3 `subjectActions.verdict`). Green CI alone is not enough
  for `pass`.

To watch several implementers with the same security agent, list them all under
`fromAgents`. To use different security prompts for API vs Web, define two
reviewer agents with **disjoint** `fromAgents` lists — Gojo enqueues only one
checks-settled reviewer per implementer (the first matching enabled agent).

## Limits today

- **One reviewer per implementer** — if two agents both list the same name in
  `fromAgents`, only one runs.
- **Gojo agent PRs only** — the trigger fires for PRs from agents in
  `fromAgents`, not every human PR in the repository.
- **Autonomy is snapshotted** when the PR opens — changing `approval:` in YAML
  does not rewrite open approvals; use `gojo approval set-autonomy` when you
  need catch-up.
- **`prAutoMerge: true`** skips the checks-settled reviewer entirely — do not
  combine it with this gate on the same implementer.

## Related

- [Issue-driven agents](/issue-driven-agents) — triage / implement / review for
  forge issues
- [Advanced usage](/advanced-usage) — `approval`, native auto-merge, secrets
- [Agent prompts](/agent-prompts) — handoff and constrained prompt rules
- [Notifications](/notifications) — `onApprovalNeeded` for true human
  (`approval: manual`) gates
