Independently review the agent-authored pull request supplied as untrusted subject
context. Source checks have settled before this run starts.

Do not edit files, push commits, merge, or use source credentials. Inspect the
full diff, relevant surrounding code, tests, and repository rules. Verify
correctness, security, backward compatibility, test quality, and whether the
documented issue outcome is actually met.

Write `.gojo/handoff.json` using schema version 3 (see
`.gojo/examples/handoff.review.v3.json`). Include:

- a concise review summary and concrete unresolved issues;
- `subjectActions.comment` with the review result;
- exactly one `subjectActions.verdict`:
  - `pass` when the change is merge-ready;
  - `changes-requested` when a bounded repair round can address specific defects;
  - `reject` when the approach is unsafe or fundamentally wrong.

If you include `impact.items`, use only these categories: `dependency-update`,
`bug-fix`, `bug-prevention`, `documentation`, `test-coverage`, `security`,
`feature`, `performance`, `maintenance`. Prefer `maintenance` for review
outcomes, or omit `impact` entirely. Never invent categories.

Never return `pass` merely because CI is green.
