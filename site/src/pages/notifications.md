---
layout: ../layouts/DocLayout.astro
title: Notifications
description: Configure Slack and webhook channels, route run outcomes from gojo.yaml, and understand delivery retries.
---

Gojo separates **where** notifications go (instance channels) from **when** they fire (project routing in `gojo.yaml`). Channels stay out of git; routing lives with the project.

## How notifications work

| Layer | Where | What it stores |
|-------|-------|----------------|
| Channels | Instance Settings (or API) | Named endpoints: type + webhook URL |
| Routing | `gojo.yaml` → `notifications` | Which channel names fire on success, failure, or schedule auto-disable |

1. A run finishes (`run.finished`).
2. Gojo reads the project’s `notifications.onSuccess` / `onFailure` (and `onDisabled` if a schedule was auto-disabled).
3. Those **names** look up channels on the instance.
4. Delivery is **queued** with retries so a flaky webhook does not turn a successful run into a failure.

## Create a channel (Settings)

1. Open the gojo web UI → **Settings**.
2. Scroll to **Notification channels**.
3. Click **Add channel**.
4. Set a **Name** (lowercase, hyphens — this is what `gojo.yaml` will reference, e.g. `engineering-slack`).
5. Pick a **Type** and paste the **Webhook URL**.
6. Click **Send test** — confirm the message arrives.
7. Click **Save channel**.

You can also **Send test**, **Edit**, or **Delete** from the channel table after saving.

## Get a webhook URL

| Type | How to get a URL |
|------|------------------|
| **slack** | Slack App → Incoming Webhooks → Add to workspace → copy webhook URL |
| **discord** | Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL |
| **teams** | Channel → Connectors → Incoming Webhook → configure → copy URL |
| **webhook** | Any HTTPS endpoint that accepts a JSON `POST` |
| **telegram** | Generic HTTPS POST only — **not** the Telegram Bot API. Prefer Slack, Discord, Teams, or a custom webhook. |

All types POST JSON to `webhookUrl`. Slack wraps the payload as `{ "text": "<json string>" }`; other types send the payload object directly.

## Route runs (`gojo.yaml`)

Channel **names** in the manifest must match instance channel names exactly:

```yaml
notifications:
  onSuccess:
    - engineering-slack
  onFailure:
    - engineering-slack
    - ops-webhook
  onDisabled:
    - ops-webhook
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
- **Payload** (example fields):

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
- Webhook URLs are **redacted** from error logs (`***`).

## Auto-disable notifications

In the task/schedule failure policy you can set `disableAfterConsecutiveFailedRuns`. When that threshold is hit:

1. The schedule is disabled.
2. Channels listed under `notifications.onDisabled` receive a notification.

Pair `onDisabled` with your ops channel so silent schedule death is visible.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| **Send test** fails | Bad URL, non-HTTPS, or the provider rejected the POST (4xx/5xx) |
| Real runs never notify | Channel name in `gojo.yaml` does not match Settings, or project not synced |
| Only failures notify | `onSuccess` empty or missing |
| Schedule died quietly | Missing `onDisabled`, or `disableAfterConsecutiveFailedRuns` not set |
| Telegram “doesn’t work” | Current connector is a generic webhook POST, not Bot API |

## Related

- [Settings](/settings) — instance knobs overview
- [Advanced agent](/advanced-agent) — full manifest example including notifications
- [CLI](/cli) — project sync and run inspection
- [FAQ](/faq) — common post-setup questions
