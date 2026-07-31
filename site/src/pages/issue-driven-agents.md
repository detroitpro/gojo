---
layout: ../layouts/DocLayout.astro
title: Issue-driven agents
description: Turn a trusted forge issue into a validated implementation, independent review, bounded repair loop, and platform-owned merge.
---

Issue-driven agents let you start coding work from GitHub, GitLab, or Forgejo
while away from the Gojo host. Write an actionable issue, apply `gojo:ready`,
and let Gojo carry the work through triage, implementation, CI, independent
review, and approval.

The coding agent never waits for CI, and Gojo never injects its managed source
token into the agent process. Gojo stores every transition durably and owns the
normal source-side label, comment, and merge path.

## What happens after you label an issue

1. A trusted actor applies `gojo:ready`.
2. **Triage** claims the issue, checks that the brief is actionable, and either
   adds `gojo:validated` or marks it `gojo:blocked`.
3. **Implementation** claims a validated issue, edits and tests in an isolated
   worktree, pushes a branch, and opens a pull request.
4. The implementation run ends and its worktree is removed. No model process
   waits for CI.
5. Gojo polls source checks. Red checks can start a bounded repair run on the
   existing PR branch.
6. After checks settle, **review** inspects the diff and CI evidence and returns
   `pass`, `changes-requested`, or `reject`.
7. Requested changes can start another bounded repair round. Reaching the round
   limit escalates to a human.
8. With a passing review and green checks, Gojo either merges or asks for your
   approval, according to the configured authority.

The Approvals view, CLI, trusted forge comments, and approval notifications all
use the same audited control path.

## Prerequisites

- Gojo is installed as a service and the project is registered and synced.
- The project has a GitHub, GitLab, or Forgejo source connection.
- The source token can read issues, PRs, timelines, diffs, and checks, and can
  write comments and labels and merge pull requests.
- The source repository has the workflow labels listed below.
- The project has a real validation profile for implementation work.

Check the instance before enabling triggers:

```bash
gojo server doctor
gojo project list
gojo project sources <project-id>
```

`server doctor` reports each source connection, its configured secret name, and
whether the credential is available.

## Store the source token

Prefer Gojo's encrypted secret store over a daemon-wide environment variable:

```bash
gojo source token set <source-id> --secret-name source-github
```

On an interactive terminal, Gojo prompts without echoing the token. For
automation, supply it only for that command:

```bash
GOJO_SOURCE_TOKEN="$TOKEN" \
  gojo source token set <source-id> --secret-name source-forgejo
```

Environment fallbacks such as `GH_TOKEN`, `GITHUB_TOKEN`, `FORGEJO_TOKEN`,
`GITEA_TOKEN`, and `GITLAB_TOKEN` still work, but the encrypted source secret is
the durable configuration.

Gojo removes forge write tokens from coding, reviewer, and validation process
environments. Source adapters and the merge service hold Gojo-managed
credentials; agents request validated labels, comments, and verdicts through
handoffs.

This isolation does not revoke credentials independently installed for the same
OS account, such as a `gh` login, a `tea` login, SSH keys, or Git credential
helpers. Treat adapter CLIs as trusted code on a trusted host. For a hard
security boundary against arbitrary shell commands, run coding adapters under a
separate OS/container identity that has no direct forge merge credential.

## Create the workflow labels

Keep the label contract in `.gojo/labels.md` and create these labels on the
forge:

| Label | Meaning | Who may set it |
| --- | --- | --- |
| `gojo:ready` | Authorizes triage | Trusted human |
| `gojo:validated` | Brief is actionable | Triage agent through Gojo |
| `gojo:in-progress` | Gojo owns an active claim | Gojo |
| `gojo:blocked` | Missing detail, failed run, or explicit stop | Triage, Gojo, or human |
| `gojo:auto-merge` | A passing reviewer may authorize platform merge | Trusted human |

`gojo:auto-merge` does not bypass CI, independent review, the repair-round
limit, or base-branch revalidation.

## Configure the three agents

This example uses one coding profile, one reviewer profile, a real implementation
validation profile, and a handoff-only profile for report agents:

```yaml
profiles:
  coding:
    adapter: cursor
    timeout: 90m
  reviewer:
    adapter: cursor
    timeout: 30m
    readOnly: true

validationProfiles:
  implementation:
    steps:
      - name: check
        command: make check
        timeout: 30m
      - name: handoff-exists
        command: test -f .gojo/handoff.json
        timeout: 30s
  handoff:
    steps:
      - name: handoff-exists
        command: test -f .gojo/handoff.json
        timeout: 30s

agents:
  issue-triage:
    description: Validate ready issues before implementation
    profile: reviewer
    promptFile: .gojo/agents/issue-triage.md
    validationProfile: handoff
    trigger:
      on: issue-label
      requireLabels: [gojo:ready]
      excludeLabels: [gojo:validated, gojo:blocked, gojo:in-progress]
      trustedActors: [your-forge-login]
      maxOpenClaims: 1
    concurrency:
      projectLimit: 1
      overlapPolicy: skip

  issue-implement:
    description: Implement validated issues and open pull requests
    profile: coding
    promptFile: .gojo/agents/issue-implement.md
    validationProfile: implementation
    trigger:
      on: issue-label
      requireLabels: [gojo:ready, gojo:validated]
      excludeLabels: [gojo:blocked, gojo:in-progress]
      trustedActors: [your-forge-login]
      maxOpenClaims: 1
    concurrency:
      projectLimit: 1
      overlapPolicy: skip
    integration:
      mode: pull-request
      targetBranch: main
      prTool: gh # use tea for Forgejo
      approval: reviewer
      autonomyLabels:
        auto: gojo:auto-merge
      fixRounds: 2
      requireAllValidations: true

  issue-review:
    description: Review agent PRs after source checks settle
    profile: reviewer
    promptFile: .gojo/agents/issue-review.md
    validationProfile: handoff
    trigger:
      on: pull-request-checks-settled
      fromAgents: [issue-implement]
    concurrency:
      projectLimit: 1
      overlapPolicy: skip

notifications:
  onApprovalNeeded:
    - ops-telegram
```

For Forgejo PR creation, add the same `tea` settings you use for other agents:

```yaml
integration:
  mode: pull-request
  targetBranch: main
  prTool: tea
  prLogin: home
  prRemote: origin
  prMergeStyle: squash
  approval: reviewer
  autonomyLabels:
    auto: gojo:auto-merge
  fixRounds: 2
```

Then sync:

```bash
gojo project sync <project-id>
```

## Write the prompts

All three prompts treat the issue or PR body as untrusted data. Gojo also writes
the snapshot to `.gojo/context/subject.json`; that generated file is excluded
from commits.

**Triage prompt**

- Do not edit product code.
- Check outcome, acceptance criteria, affected area, and test expectations.
- On success, request `gojo:validated`, remove `gojo:in-progress`, and comment
  with a concise implementation brief.
- Otherwise request `gojo:blocked`, release the claim, and name the missing
  information.

**Implementation prompt**

- Implement only the validated brief and add focused tests.
- Run the configured checks and write a schema-version-3 handoff.
- Never merge, enable source auto-merge, use forge tokens, or weaken checks.
- On repair rounds, address the supplied CI or reviewer evidence on the existing
  PR branch.

**Review prompt**

- Do not edit, push, or merge.
- Review the full diff, relevant surrounding code, CI evidence, regressions,
  security, and test quality.
- Return exactly one handoff verdict: `pass`, `changes-requested`, or `reject`.
- Green CI alone is not enough for `pass`.

The Gojo repository dogfoods these prompts in
[`.gojo/agents/`](https://github.com/detroitpro/gojo/tree/main/.gojo/agents).

## Choose merge authority

| Configuration | Result after green checks and reviewer pass |
| --- | --- |
| `approval: manual` | Wait in Approvals for an operator |
| `approval: reviewer` | The reviewer verdict authorizes platform merge |
| `approval: auto` | Platform may apply automatically after all gates |
| `autonomyLabels.auto: gojo:auto-merge` | That trusted issue label upgrades the work to auto authority |

In every mode, Gojo's managed flow re-reads live checks and serializes merges
through the project merge queue. Prompts should still forbid direct source
mutation, and host-level adapter credentials must follow the trust guidance
above.

## Operate it while away

### Start from the forge

1. Write the issue with a clear outcome, acceptance criteria, affected area,
   non-goals, and required tests.
2. Apply `gojo:ready` as a configured trusted actor.
3. Follow Gojo's claim and PR comments from the GitHub, GitLab, or Forgejo app.

You can also make an explicit trusted comment on an issue:

```text
/gojo claim issue-implement
```

### Decide a PR

From a trusted PR comment:

```text
/gojo approve
/gojo merge
/gojo hold
/gojo reject Explain what must change
```

Repeated comment deliveries are idempotent. `approve` and `merge` use the same
platform approval action; neither gives the commenting account's credential to
an agent.

From the CLI:

```bash
gojo approval list
gojo approval show <approval-id>
gojo approval approve <approval-id>
gojo approval hold <approval-id>
gojo approval reject <approval-id> --note "reason"
```

To claim a work item directly:

```bash
gojo work claim <work-item-id> --agent <agent-id>
```

Approval-needed notifications can include a short-lived, single-use confirmation
link. Opening it shows a confirmation page; approving consumes the token.

## What to watch

- **Projects → Work:** issue claim, execution state, source freshness, and PR.
- **Runs:** triage, implementation, review, and repair runs remain separate.
- **Integrations:** open or merged PR delivery.
- **Approvals:** checks, reviewer verdict, repair count, source link, diff, and
  Approve / Hold / Reject controls.
- `gojo server doctor`: missing write credentials or instance warnings.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Label does not start a run | The label actor is in `trustedActors`; required and excluded labels match; project was synced |
| Issue remains `gojo:in-progress` | Inspect the linked run and handoff; a failed/invalid handoff should block and release the issue |
| PR opens but no reviewer runs | Source checks have settled and `fromAgents` includes the implementing agent |
| Repair does not run | `fixRounds` is greater than zero and the approval still has rounds available |
| Approval waits unexpectedly | Check `approval`, `gojo:auto-merge`, reviewer verdict, and live check state |
| Merge is blocked | Token has merge permission, branch protection permits the operation, checks are green, and the target branch is current |
| Forge comment is ignored | Comment author is trusted and the command occupies the complete trimmed comment |
| Source write fails | Run `gojo server doctor`, rotate with `gojo source token set`, then refresh the source |

## Related

- [Agent prompt best practices](/agent-prompts)
- [Advanced usage](/advanced-usage)
- [Project visibility and sources](/project-visibility)
- [Notifications](/notifications)
- [CLI reference](/cli)
