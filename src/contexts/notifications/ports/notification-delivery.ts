import type { NotificationChannelConfig } from "@shared/notifications";

/**
 * Delivers a payload to a *test* channel. Concrete implementations wrap the
 * live `NotificationDispatcher` so use cases don't take on transport concerns.
 */
export interface NotificationDeliveryPort {
  deliverTest(channel: NotificationChannelConfig, payload: unknown): Promise<{ ok: true } | { ok: false; message: string; secrets?: string[] }>;
}
