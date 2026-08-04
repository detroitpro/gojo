/**
 * Pure invariants for notification channels. No IO, just parsing / shaping
 * helpers around the shared schemas so use cases can stay small.
 */
import type { NotificationChannelConfig } from "@shared/notifications";

export type ChannelTestPayload = {
  test: true;
  project: string;
  agent: string;
  runId: string;
  state: string;
  error: string | null;
  finishedAt: string;
};

export function buildTestPayload(finishedAt: string): ChannelTestPayload {
  return {
    test: true,
    project: "gojo-test",
    agent: "notification-test",
    runId: "test",
    state: "Succeeded",
    error: null,
    finishedAt,
  };
}

/** Extracts sensitive strings from a channel config so error text can redact them. */
export function channelSecrets(config: NotificationChannelConfig): string[] {
  return config.type === "telegram"
    ? [config.botToken]
    : [config.webhookUrl];
}
