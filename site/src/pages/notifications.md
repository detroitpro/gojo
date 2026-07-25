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
| Routing | `gojo.yaml` → `notifications` | Which channel names fire on success, failure, or schedule auto-disable |

1. A run finishes (`run.finished`).
2. Gojo reads the project’s `notifications.onSuccess` / `onFailure` (and `onDisabled` if a schedule was auto-disabled).
3. Those **names** look up channels on the instance.
4. Delivery is **queued** with retries so a flaky provider does not turn a successful run into a failure.

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

Telegram uses the Bot API: `sendMessage` with a short human-readable text (project, task, state, run id, error) — not a raw JSON dump.

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
```

Then sync the project (`gojo project sync` or **Projects → Sync** in the UI) so the manifest is loaded.

| Key | When it fires |
|-----|----------------|
| `onSuccess` | Run ended in `Succeeded` |
| `onFailure` | Run ended in any other terminal state (failed, canceled, timed out, …) |
| `onDisabled` | After a scheduled run, the schedule was auto-disabled for consecutive failures |

## Delivery behavior

- **Queue:** notifications are written to a local queue and processed on a short interval.
- **Retries:** up to 5 attempts with backoff (~1s, 2s, 4s, 8s after the first try).
- **Payload** (example fields for webhook types):

```json
{
  "project": "demo",
  "task": "nightly-deps",
  "runId": "01J…",
  "state": "Failed",
  "error": "validation failed",
  "finishedAt": "2026-07-23T12:00:00.000Z"
}
```

- **Test sends** include `"test": true`.
- **Auto-disable** payloads also include `reason`, `scheduleId`, and `consecutiveFailures`.
- Webhook URLs and Telegram bot tokens are **redacted** from error logs (`***`).

## Auto-disable notifications

In the task/schedule failure policy you can set `disableAfterConsecutiveFailedRuns`. When that threshold is hit:

1. The schedule is disabled.
2. Channels listed under `notifications.onDisabled` receive a notification.

Pair `onDisabled` with your ops channel so silent schedule death is visible.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| **Send test** fails | Bad URL/token, non-HTTPS webhook, wrong chat id, or the provider rejected the request |
| Real runs never notify | Channel name in `gojo.yaml` does not match Settings, or project not synced |
| Only failures notify | `onSuccess` empty or missing |
| Schedule died quietly | Missing `onDisabled`, or `disableAfterConsecutiveFailedRuns` not set |
| Telegram 401/404 | Invalid bot token, or the bot has not been started / added to the chat |

## Related

- [Settings](/settings) — instance knobs overview
- [Advanced agent](/advanced-agent) — full manifest example including notifications
- [CLI](/cli) — project sync and run inspection
- [FAQ](/faq) — common post-setup questions
