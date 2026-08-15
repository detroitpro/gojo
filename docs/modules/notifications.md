# Module: notifications

**Paths:** `src/contexts/notifications/`, `packages/contracts/src/notifications.ts`

## Responsibility

Notifications answer "who hears about a finished run or required approval, and what do they read." The module owns
routing resolution, payload shape, and delivery with retries. It does not own run outcomes, and a
delivery failure never turns a successful run into a failed one.

Two layers stay separate:

| Layer | Where | Contents |
|-------|-------|----------|
| Channels (**where**) | `instance_settings.notification_channels` | Named endpoints: Slack/Discord/Teams/webhook URL, or Telegram bot token and chat id |
| Routing (**when**) | Project manifest, per project or per agent | Channel names for `onSuccess`, `onFailure`, `onDisabled`, `onApprovalNeeded` |

Channels are instance state so secrets never enter a repository. Routing lives with the project so it
travels with the manifest.

## Routing precedence

`run.finished` and `run.awaiting_approval` resolve routing agent-first:

1. `agents.<name>.notifications` in the manifest, persisted to `agents.notifications_json`
2. Otherwise top-level `notifications`

An agent block replaces project routing for that agent rather than merging with it, so a single
reporting agent can be the only thing that messages an operator while every other agent stays silent
under an empty project-level `notifications: {}`. An agent block with no channel names in it is
treated as absent and falls back to the project.

## Payload

```json
{
  "project": "gojo",
  "agent": "activity-digest",
  "runId": "01J…",
  "state": "Succeeded",
  "error": null,
  "finishedAt": "2026-07-28T12:00:00.000Z",
  "summary": "<adapter-authored report text>",
  "handoffStatus": "no-change"
}
```

`summary` and `handoffStatus` come from the run's handoff, resolved by `resolveRunHandoffSummary` in
`src/contexts/execution/application/inspect.ts` (re-exported on `execution/contract.ts`): the merged artifact first, then the newest attempt's raw `handoff_json` so runs
that failed before the artifact was written still carry text. The coordinator writes the artifact
before emitting `run.finished`, so the hook always sees a completed handoff.

The adapter/agent owns this text. The platform delivers it verbatim and only prepends routing context
(project, agent, run id). Auto-disable payloads add `reason`, `scheduleId`, and `consecutiveFailures`;
test sends add `test: true`.

Approval-needed payloads use `state: "approval-needed"`. Two emitters share
`run.awaiting_approval`:

- **`await-approval` integration** (`coordinator.ts`) — emits with run id only;
  `run-lifecycle` enqueues `onApprovalNeeded` with project/agent/run fields and
  null `approvalId` / `approveUrl` / `prUrl`.
- **Durable PR approval** (`delivery/subscribers/approval-change.ts`) — when
  state is `awaiting-human`, includes `approvalId`, `prUrl`, `reviewerVerdict`,
  and `checksState`. When `publicBaseUrl` and an admin user exist, `approveUrl`
  points at the HTML confirm page (`GET /api/v1/approvals/{id}/approve-link?token=…`)
  backed by a 24-hour `control:approve:{approvalId}` token revoked after a
  successful POST.

Delivery remains asynchronous and cannot alter approval or run state.

## Delivery

Webhook-like channels POST the payload object; Slack wraps it as `{ "text": … }`. Telegram renders a
human-readable header followed by `summary` as the message body, truncated to the Bot API limit of
4096 characters. The text is sent with `parse_mode: HTML` after escaping raw markup and converting
agent `**bold**` markers to `<b>…</b>`, so digest headers render bold without trusting raw HTML from
the agent. Work is queued in `notifications` and retried up to five times with backoff. Webhook URLs
and bot tokens are redacted from error logs.

## Boundaries

- Notifications own routing resolution, payload assembly, and delivery.
- Runs own the handoff and emit `run.finished`; notifications only read.
- Scheduler owns auto-disable; notifications only report it.
- Adapters (agent implementations) own report text. The platform must not rewrite or summarize it.
