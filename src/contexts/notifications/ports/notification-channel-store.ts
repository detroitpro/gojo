import type { NotificationChannelMap } from "@shared/notifications";

/** Persists the instance-level notification channel map. */
export interface NotificationChannelStore {
  get(): NotificationChannelMap;
  put(channels: NotificationChannelMap): NotificationChannelMap;
}
