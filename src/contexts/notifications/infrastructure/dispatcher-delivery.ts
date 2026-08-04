import type { NotificationChannelConfig } from "@shared/notifications";

import { redactSecrets, type NotificationDispatcher } from "@/contexts/notifications/infrastructure/dispatcher";

import { channelSecrets } from "../domain/channels";
import type { NotificationDeliveryPort } from "../ports/notification-delivery";

/**
 * Bridges the live `NotificationDispatcher.deliver` into the notifications
 * context port so the test-channel command can stay transport-free.
 */
export class NotificationDispatcherDelivery implements NotificationDeliveryPort {
  constructor(private readonly dispatcher: NotificationDispatcher) {}

  async deliverTest(
    config: NotificationChannelConfig,
    payload: unknown,
  ): Promise<{ ok: true } | { ok: false; message: string; secrets?: string[] }> {
    const channelConfig =
      config.type === "telegram"
        ? {
            botToken: config.botToken,
            chatId: config.chatId,
            ...(config.config ?? {}),
          }
        : {
            webhookUrl: config.webhookUrl,
            ...(config.config ?? {}),
          };
    const channel = {
      id: "test",
      type: config.type,
      config: channelConfig,
    };
    try {
      await this.dispatcher.deliver(channel, payload);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const secrets = channelSecrets(config);
      return { ok: false, message: redactSecrets(message, secrets), secrets };
    }
  }
}
