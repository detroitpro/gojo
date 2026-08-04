import {
  safeParseNotificationChannelMap,
  type NotificationChannelMap,
} from "@shared/notifications";

import {
  domainEvent,
  err,
  ok,
  type Clock,
  type Result,
  type UnitOfWork,
} from "@/kernel";

import type { NotificationChannelStore } from "../ports/notification-channel-store";

export type SetChannelsDeps = {
  store: NotificationChannelStore;
  clock: Clock;
  uow: UnitOfWork;
};

export async function setNotificationChannelsCommand(
  deps: SetChannelsDeps,
  input: unknown,
): Promise<Result<{ channels: NotificationChannelMap }>> {
  const parsed = safeParseNotificationChannelMap(input);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => issue.message).join("; ") || "invalid channel map");
  }
  const saved = deps.store.put(parsed.data);
  deps.uow.addEvent(
    domainEvent(
      {
        type: "notifications.channels.updated",
        entityKind: "instance",
        entityId: "notifications",
        topics: ["dashboard"],
        data: { count: Object.keys(saved).length },
      },
      deps.clock.nowIso(),
    ),
  );
  return ok({ channels: saved });
}
