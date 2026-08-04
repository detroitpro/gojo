import type { NotificationChannelMap } from "@shared/notifications";

import { ok, type Result } from "@/kernel";

import type { NotificationChannelStore } from "../ports/notification-channel-store";

export type GetChannelsDeps = { store: NotificationChannelStore };

export async function getNotificationChannelsQuery(
  deps: GetChannelsDeps,
): Promise<Result<{ channels: NotificationChannelMap }>> {
  return ok({ channels: deps.store.get() });
}
