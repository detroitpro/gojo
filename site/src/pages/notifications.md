---
layout: ../layouts/DocLayout.astro
title: Notifications
description: Configure Slack, Telegram, and webhook channels, route run outcomes from gojo.yaml, and understand delivery retries.
---

Gojo separates **where** notifications go (instance channels) from **when** they fire (project routing in `gojo.yaml`). Channels stay out of git; routing lives with the project.

## How notifications work

| Layer | Where | What it stores |
|-------|-------|----------------|
| Channels | Instance Settings (or API) | Named endpoints: Slack/Discord/Teams/webhook URL, or Telegram bot token + chat id |
| Routing | `gojo.yaml` → `notifications` (project or per-agent) | Which channel names fire on success, failure, or schedule auto-disable |

1. A run finishes (`run.finished`) or a durable PR approval enters
   `awaiting-human` (`run.awaiting_approval`).
2. Gojo reads the matching project routing.
3. Those **names** look up channels on the instance.
4. Delivery is **queued** with retries so a flaky provider does not change run
   or approval state.

## Create a channel (Settings)

1. Open the gojo web UI → **Settings**.
2. Scroll to **Notification channels**.
3. Click **Add channel**.
4. Set a **Name** (lowercase, hyphens — this is what `gojo.yaml` will reference, e.g. `engineering-slack`).
5. Pick a **Type** and fill the fields (webhook URL, or Telegram bot token + chat id).
6. Click **Send test** — confirm the message arrives.
7. Click **Save channel**.

You can also **Send test**, **Edit**, or **Delete** from the channel table after saving.

## Channel types

| Type | How to configure |
|------|------------------|
| **slack** | Slack App → Incoming Webhooks → Add to workspace → copy webhook URL |
| **discord** | Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL |
| **teams** | Channel → Connectors → Incoming Webhook → configure → copy URL |
| **webhook** | Any HTTPS endpoint that accepts a JSON `POST` |
| **telegram** | Talk to [@BotFather](https://t.me/BotFather) for a bot token. Message the bot (or add it to a group), then open `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id` (groups are negative). |

Webhook-like types POST JSON to `webhookUrl`. Slack wraps the payload as `{ "text": "<json string>" }`; other webhook types send the payload object directly.

Telegram uses the Bot API: `sendMessage` with human-readable text (project, agent, state, run id, error) — not a raw JSON dump. If the run wrote a handoff, its `summary` follows as the message body.

## Route runs (`gojo.yaml`)

Channel **names** in the manifest must match instance channel names exactly:

```yaml
notifications:
  onSuccess:
    - engineering-slack
  onFailure:
    - engineering-slack
    - ops-telegram
  onDisabled:
    - ops-telegram
  onApprovalNeeded:
    - ops-telegram
```

Then sync the project (`gojo project sync` or **Projects → Sync** in the UI) so the manifest is loaded.

| Key | When it fires |
|-----|----------------|
| `onSuccess` | Run ended in `Succeeded` |
| `onFailure` | Run ended in any other terminal state (failed, canceled, timed out, …) |
| `onDisabled` | After a scheduled run, the schedule was auto-disabled for consecutive failures |
| `onApprovalNeeded` | A reviewed PR enters `awaiting-human` before the run is terminal |

Approval-needed payloads include the approval id, PR URL when available, checks
state, reviewer verdict, and a short-lived single-use confirmation URL when
`publicBaseUrl` and an admin user are configured. The confirmation page performs
no action until you press **Approve**; a successful attempt revokes its token.

## Route a single agent

Top-level `notifications` applies to every agent in the project. To have **one** agent notify while
the rest stay silent, put a `notifications` block on that agent and leave the project block empty:

```yaml
agents:
  activity-digest:
    description: Daily executive brief on what shipped in the last 24h
    profile: cursor
    promptFile: .gojo/agents/activity-digest.md
    validationProfile: handoff
    notifications:
      onSuccess:
        - ops-telegram
      onFailure:
        - ops-telegram

notifications: {}
```

An agent block **replaces** project routing for that agent; it does not merge with it. An agent with
no `notifications` block falls back to the project block as before.

## Report text in the message

Whatever the adapter writes as `summary` in `.gojo/handoff.json` is delivered as the message body,
verbatim. That makes a report-only agent a usable digest: it researches, writes the finished
message, and gojo delivers it.

Use `**bold**` for section labels and per-item headers — gojo sends Telegram with HTML parse mode
and converts those markers to real bold after escaping raw markup. Put a blank line between each
header and its detail paragraph so the message stays scannable. Telegram caps messages at 4096
characters and gojo truncates past that.

## Delivery behavior

- **Queue:** notifications are written to a local queue and processed on a short interval.
- **Retries:** up to 5 attempts with backoff (~1s, 2s, 4s, 8s after the first try).
- **Payload** (example fields for webhook types):

```json
{
  "project": "demo",
  "agent": "maintain-deps",
  "runId": "01J…",
  "state": "Failed",
  "error": "validation failed",
  "finishedAt": "2026-07-23T12:00:00.000Z",
  "summary": "<handoff summary, or null>",
  "handoffStatus": "failed"
}
```

- **Test sends** include `"test": true`.
- **Auto-disable** payloads also include `reason`, `scheduleId`, and `consecutiveFailures`.
- **Approval-needed** payloads also include `approvalId`, `approveUrl`, `prUrl`, `reviewerVerdict`, and `checksState`.
- Webhook URLs and Telegram bot tokens are **redacted** from error logs (`***`).

## Auto-disable notifications

In the agent/schedule failure policy you can set `disableAfterConsecutiveFailedRuns`. When that threshold is hit:

1. The schedule is disabled.
2. Channels listed under `notifications.onDisabled` receive a notification.

Pair `onDisabled` with your ops channel so silent schedule death is visible.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| **Send test** fails | Bad URL/token, non-HTTPS webhook, wrong chat id, or the provider rejected the request |
| Real runs never notify | Channel name in `gojo.yaml` does not match Settings, or project not synced |
| Only failures notify | `onSuccess` empty or missing |
| Every agent notifies | Routing is on the project block; move it to the one agent that should notify |
| Message has no report text | The run wrote no handoff, or its `summary` was empty |
| Schedule died quietly | Missing `onDisabled`, or `disableAfterConsecutiveFailedRuns` not set |
| Approval needs attention but no message arrives | Missing `onApprovalNeeded`, channel name mismatch, or no `publicBaseUrl` for the link |
| Telegram 401/404 | Invalid bot token, or the bot has not been started / added to the chat |

## Related

- [Settings](/settings) — instance knobs overview
- [Advanced agent](/advanced-agent) — full manifest example including notifications
- [Issue-driven agents](/issue-driven-agents) — approval routing and remote decisions
- [CLI](/cli) — project sync and run inspection
- [FAQ](/faq) — common post-setup questions
