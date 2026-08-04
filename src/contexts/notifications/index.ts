import type { NotificationDispatcher } from "@/contexts/notifications/infrastructure/dispatcher";
import type { Database } from "@/infrastructure/persistence";
import {
  InMemoryUnitOfWork,
  SystemClock,
  type Clock,
  type Outbox,
  type UnitOfWork,
} from "@/kernel";

import { getNotificationChannelsQuery } from "./application/get-channels";
import { setNotificationChannelsCommand } from "./application/set-channels";
import { testNotificationChannelCommand } from "./application/test-channel";
import { NotificationDispatcherDelivery } from "./infrastructure/dispatcher-delivery";
import { SqliteNotificationChannelStore } from "./infrastructure/sqlite-channel-store";
import type { NotificationChannelStore } from "./ports/notification-channel-store";
import type { NotificationDeliveryPort } from "./ports/notification-delivery";

export * from "./contract";

export interface NotificationsModule {
  store: NotificationChannelStore;
  delivery: NotificationDeliveryPort;
  getChannels: () => ReturnType<typeof getNotificationChannelsQuery>;
  setChannels: (input: unknown) => ReturnType<typeof setNotificationChannelsCommand>;
  testChannel: (input: unknown) => ReturnType<typeof testNotificationChannelCommand>;
}

export function buildNotificationsModule(deps: {
  db: Database;
  dispatcher: NotificationDispatcher;
  clock?: Clock;
  outbox?: Outbox;
  uow?: UnitOfWork;
}): NotificationsModule {
  const clock = deps.clock ?? new SystemClock();
  const uow = deps.uow ?? new InMemoryUnitOfWork();
  const store = new SqliteNotificationChannelStore(deps.db);
  const delivery = new NotificationDispatcherDelivery(deps.dispatcher);

  return {
    store,
    delivery,
    getChannels: () => getNotificationChannelsQuery({ store }),
    setChannels: async (input) => {
      uow.clearEvents();
      const result = await setNotificationChannelsCommand({ store, clock, uow }, input);
      if (result.ok && deps.outbox) {
        deps.outbox.publish(uow.events());
      }
      uow.clearEvents();
      return result;
    },
    testChannel: (input) => testNotificationChannelCommand({ delivery, clock }, input),
  };
}
