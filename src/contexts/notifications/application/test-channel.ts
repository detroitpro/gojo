import {
  safeParseNotificationChannelConfig,
} from "@shared/notifications";

import { err, ok, type Clock, type Result } from "@/kernel";

import { buildTestPayload } from "../domain/channels";
import type { NotificationDeliveryPort } from "../ports/notification-delivery";

export type TestChannelDeps = {
  delivery: NotificationDeliveryPort;
  clock: Clock;
};

export async function testNotificationChannelCommand(
  deps: TestChannelDeps,
  input: unknown,
): Promise<Result<{ ok: true }, { message: string; secrets?: string[] }>> {
  const parsed = safeParseNotificationChannelConfig(input);
  if (!parsed.success) {
    return err({
      message:
        parsed.error.issues.map((issue) => issue.message).join("; ") || "invalid channel",
    });
  }
  const payload = buildTestPayload(deps.clock.nowIso());
  const result = await deps.delivery.deliverTest(parsed.data, payload);
  if (result.ok) {
    return ok({ ok: true });
  }
  return err({ message: result.message, ...(result.secrets ? { secrets: result.secrets } : {}) });
}
