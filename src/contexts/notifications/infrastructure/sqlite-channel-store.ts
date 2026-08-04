import type { NotificationChannelMap } from "@shared/notifications";

import type { Database } from "@/infrastructure/persistence";
import {
  getInstanceSetting,
  setInstanceSetting,
} from "@/infrastructure/persistence/instance-settings";

import type { NotificationChannelStore } from "../ports/notification-channel-store";

export class SqliteNotificationChannelStore implements NotificationChannelStore {
  constructor(private readonly db: Database) {}

  get(): NotificationChannelMap {
    const value = getInstanceSetting(this.db, "notification_channels");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return value as NotificationChannelMap;
  }

  put(channels: NotificationChannelMap): NotificationChannelMap {
    setInstanceSetting(this.db, "notification_channels", channels);
    return this.get();
  }
}
