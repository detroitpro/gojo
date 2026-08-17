/**
 * Public surface of the notifications context.
 */
export type { NotificationChannelStore } from "./ports/notification-channel-store";
export type { NotificationDeliveryPort } from "./ports/notification-delivery";

export type { ChannelTestPayload } from "./domain/channels";
export { buildTestPayload, channelSecrets } from "./domain/channels";

export type { GetChannelsDeps } from "./application/get-channels";
export { getNotificationChannelsQuery } from "./application/get-channels";
export type { SetChannelsDeps } from "./application/set-channels";
export { setNotificationChannelsCommand } from "./application/set-channels";
export type { TestChannelDeps } from "./application/test-channel";
export { testNotificationChannelCommand } from "./application/test-channel";

export { NotificationDispatcher } from "./infrastructure/dispatcher";
export { wireNotificationHooks } from "./subscribers/run-lifecycle";
