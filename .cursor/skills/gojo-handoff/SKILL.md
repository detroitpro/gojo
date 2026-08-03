---
name: gojo-handoff
description: >-
  Writes and validates gojo agent handoff.json against the platform schema
  (impact categories, subjectActions verdicts). Use when authoring or fixing
  .gojo/handoff.json, issue-review/triage prompts, or project instructions that
  teach the handoff contract.
---

# gojo handoff contract

Agents write `.gojo/handoff.json`. gojo validates it before PR bodies, impact
accounting, and review/merge policy.

## Schema versions

| Version | Use |
|---------|-----|
| 1 | Minimal required fields |
| 2 | + optional `impact.items` |
| 3 | + optional `subjectActions` (labels, comment, review verdict) |

Prefer **v3** whenever the agent may set labels/comments/verdicts. v2/v3 fields
can coexist. Golden review example: [`.gojo/examples/handoff.review.v3.json`](../../../.gojo/examples/handoff.review.v3.json).
Schema source: [`src/shared/handoff.ts`](../../../src/shared/handoff.ts).

## Required fields

`schemaVersion`, `runId` (placeholder ULID ok), `status`, `summary`,
`startingCommit`, `resultCommit`, `filesChanged`, `validation`, `decisions`,
`unresolvedIssues`, `recommendedNextActions`, `agentAssessment`.

`status`: `completed` | `partial` | `failed` | `no-change`.

## Impact categories (exact enum)

`dependency-update` · `bug-fix` · `bug-prevention` · `documentation` ·
`test-coverage` · `security` · `feature` · `performance` · `maintenance`

- One item per concrete subject (one package, one issue, one module).
- **Omit `impact` entirely** if unsure — never invent categories (`code-quality`,
  `refactor`, etc. are rejected).
- Prefer `maintenance` for structural/architecture review outcomes.

## subjectActions (review / triage)

| Field | Values |
|-------|--------|
| `verdict` | `pass` · `changes-requested` · `reject` |
| `addLabels` / `removeLabels` | non-empty strings |
| `comment` | review or triage note |

Review agents must include exactly one `verdict`. Do not return `pass` only
because CI is green.

## Platform recovery

Invalid optional `impact` / `assets` / `prUrl` are dropped so a valid
`subjectActions.verdict` still applies. Still teach the enum — recovery is a
safety net, not a license to invent fields.

## Checklist before finishing a run

1. JSON parses.
2. Categories/verdicts match the enums above.
3. Review agents include `subjectActions.verdict`.
4. Do not `git add` `.gojo/handoff.json` or `.gojo/assets/`.
