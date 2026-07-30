import { ulid } from "ulid";

import type { Database } from "@/storage";

export interface NotificationChannel {
  id: string;
  type: "slack" | "webhook" | "discord" | "teams" | "telegram";
  config: Record<string, unknown>;
}

export type NotificationStatus = "pending" | "sent" | "failed";

interface NotificationRow {
  id: string;
  run_id: string;
  channel: string;
  status: NotificationStatus;
  payload_json: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function redactSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length === 0) {
      continue;
    }
    result = result.split(secret).join("***");
  }
  return result;
}

function extractWebhookUrl(channel: NotificationChannel): string {
  const url = channel.config["webhookUrl"];
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(`Missing webhookUrl for notification channel ${channel.id}`);
  }
  return url;
}

function extractTelegramCreds(channel: NotificationChannel): {
  botToken: string;
  chatId: string;
} {
  const botToken = channel.config["botToken"];
  const chatId = channel.config["chatId"];
  if (typeof botToken !== "string" || botToken.length === 0) {
    throw new Error(`Missing botToken for notification channel ${channel.id}`);
  }
  if (chatId === undefined || chatId === null || String(chatId).length === 0) {
    throw new Error(`Missing chatId for notification channel ${channel.id}`);
  }
  return { botToken, chatId: String(chatId) };
}

/** Telegram rejects messages longer than 4096 characters. */
const TELEGRAM_MAX_CHARS = 4096;
const TRUNCATION_MARKER = "\n… truncated";

export function truncateForTelegram(text: string): string {
  if (text.length <= TELEGRAM_MAX_CHARS) {
    return text;
  }
  return text.slice(0, TELEGRAM_MAX_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/** Short human text for Telegram (not a raw JSON dump). */
export function formatTelegramText(payload: unknown): string {
  if (typeof payload === "string") {
    return truncateForTelegram(payload);
  }
  if (!payload || typeof payload !== "object") {
    return String(payload);
  }
  const record = payload as Record<string, unknown>;
  const state = typeof record["state"] === "string" ? record["state"] : "notification";
  const project = typeof record["project"] === "string" ? record["project"] : null;
  const agent = typeof record["agent"] === "string" ? record["agent"] : null;
  const runId = typeof record["runId"] === "string" ? record["runId"] : null;
  const error = typeof record["error"] === "string" ? record["error"] : null;
  const summary = typeof record["summary"] === "string" ? record["summary"].trim() : "";
  const test = record["test"] === true;

  const lines: string[] = [];
  lines.push(test ? `gojo test: ${state}` : `gojo: ${state}`);
  if (project && agent) {
    lines.push(`${project} / ${agent}`);
  } else if (project) {
    lines.push(project);
  } else if (agent) {
    lines.push(agent);
  }
  if (runId && runId !== "test") {
    lines.push(`run ${runId}`);
  }
  if (error) {
    lines.push(`error: ${error}`);
  }
  // The agent authors this text; the header above is only routing context.
  if (summary.length > 0) {
    lines.push("", summary);
  }
  return truncateForTelegram(lines.join("\n"));
}

function channelSecrets(channel: NotificationChannel): string[] {
  const secrets: string[] = [];
  if (typeof channel.config["webhookUrl"] === "string") {
    secrets.push(channel.config["webhookUrl"]);
  }
  if (typeof channel.config["botToken"] === "string") {
    secrets.push(channel.config["botToken"]);
  }
  return secrets;
}

function serializeChannel(channel: NotificationChannel): string {
  return JSON.stringify({ id: channel.id, type: channel.type, config: channel.config });
}

function parseStoredChannel(raw: string): NotificationChannel {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid stored notification channel");
  }

  const record = parsed as Record<string, unknown>;
  return {
    id: String(record["id"] ?? "unknown"),
    type: record["type"] as NotificationChannel["type"],
    config: (record["config"] as Record<string, unknown>) ?? {},
  };
}

export class NotificationDispatcher {
  private readonly db: Database;
  private readonly fetchFn: typeof fetch;

  constructor(db: Database, fetchFn: typeof fetch = fetch) {
    this.db = db;
    this.fetchFn = fetchFn;
  }

  async enqueue(runId: string, channel: NotificationChannel, payload: unknown): Promise<string> {
    const id = ulid();
    const createdAt = nowIso();
    const payloadJson = JSON.stringify({ channel, payload });

    this.db
      .connection()
      .query(
        `INSERT INTO notifications (
          id, run_id, channel, status, payload_json, attempts, last_error, created_at, sent_at
        ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, NULL)`,
      )
      .run(id, runId, serializeChannel(channel), "pending", payloadJson, createdAt);

    return id;
  }

  async processQueue(signal?: AbortSignal): Promise<number> {
    const sqlite = this.db.connection();
    const rows = sqlite
      .query<NotificationRow, [NotificationStatus]>(
        `SELECT * FROM notifications WHERE status = ? ORDER BY created_at`,
      )
      .all("pending");

    let processed = 0;

    for (const row of rows) {
      if (signal?.aborted) {
        break;
      }

      const backoffMs = BASE_BACKOFF_MS * 2 ** Math.max(0, row.attempts - 1);
      if (row.attempts > 0) {
        await sleep(backoffMs, signal);
      }

      const stored = JSON.parse(row.payload_json) as {
        channel: NotificationChannel;
        payload: unknown;
      };

      try {
        await this.deliver(stored.channel, stored.payload);
        sqlite
          .query(
            "UPDATE notifications SET status = ?, sent_at = ?, attempts = attempts + 1 WHERE id = ?",
          )
          .run("sent", nowIso(), row.id);
        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const redacted = redactSecrets(message, channelSecrets(stored.channel));
        const attempts = row.attempts + 1;
        const status: NotificationStatus = attempts >= MAX_ATTEMPTS ? "failed" : "pending";

        sqlite
          .query(
            "UPDATE notifications SET status = ?, attempts = ?, last_error = ? WHERE id = ?",
          )
          .run(status, attempts, redacted, row.id);

        console.error(
          JSON.stringify({
            level: "error",
            component: "notifications",
            notificationId: row.id,
            channelId: stored.channel.id,
            error: redacted,
          }),
        );
      }
    }

    return processed;
  }

  async deliver(channel: NotificationChannel, payload: unknown): Promise<void> {
    if (channel.type === "telegram") {
      await this.deliverTelegram(channel, payload);
      return;
    }

    const webhookUrl = extractWebhookUrl(channel);
    const body =
      channel.type === "slack"
        ? JSON.stringify({ text: typeof payload === "string" ? payload : JSON.stringify(payload) })
        : JSON.stringify(payload);

    const response = await this.fetchFn(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      throw new Error(`Notification delivery failed with status ${response.status}`);
    }
  }

  private async deliverTelegram(
    channel: NotificationChannel,
    payload: unknown,
  ): Promise<void> {
    const { botToken, chatId } = extractTelegramCreds(channel);
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatTelegramText(payload),
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Telegram delivery failed with status ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
  }
}

export { redactSecrets, parseStoredChannel, channelSecrets };
