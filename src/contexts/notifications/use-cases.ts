import { z } from "zod";

import { NotificationChannelMapSchema } from "@shared/notifications";

import { useCaseFailure } from "@/platform/errors";
import { defineCommand, defineQuery } from "@/platform/registry";
import type { AppRuntime } from "@/platform/runtime";

const AnyRecord = z.record(z.unknown()).default({});

export const GetNotificationChannels = defineQuery<
  Record<string, never>,
  { channels: z.infer<typeof NotificationChannelMapSchema> },
  AppRuntime
>({
  name: "notifications.channels.get",
  input: z.any().transform(() => ({} as Record<string, never>)),
  output: z.object({ channels: NotificationChannelMapSchema }),
  http: { method: "GET", path: "/api/v1/notification-channels" },
  async handle(_input, runtime) {
    return runtime.notifications.getChannels();
  },
});

export const SetNotificationChannels = defineCommand<
  Record<string, unknown>,
  { channels: z.infer<typeof NotificationChannelMapSchema> },
  AppRuntime
>({
  name: "notifications.channels.set",
  input: AnyRecord,
  output: z.object({ channels: NotificationChannelMapSchema }),
  http: { method: "PUT", path: "/api/v1/notification-channels" },
  async handle(input, runtime) {
    return runtime.notifications.setChannels(input);
  },
});

const TestChannelInput = AnyRecord;

export const TestNotificationChannel = defineCommand<
  Record<string, unknown>,
  { ok: boolean },
  AppRuntime
>({
  name: "notifications.channels.test",
  input: TestChannelInput,
  output: z.object({ ok: z.boolean() }),
  http: { method: "POST", path: "/api/v1/notification-channels/test" },
  async handle(input, runtime) {
    const result = await runtime.notifications.testChannel(input);
    if (result.ok) {
      return { ok: true, value: { ok: true } };
    }
    // Delivery failures surface a `secrets` list (already redacted upstream); parse
    // errors don't. Preserve the legacy status split (400 for validation, 502 for
    // delivery) so router.test contract stays green.
    if (result.error.secrets) {
      return useCaseFailure("delivery_failed", result.error.message, 502);
    }
    return useCaseFailure("validation_error", result.error.message, 400);
  },
});

export const notificationsUseCases = [
  GetNotificationChannels,
  SetNotificationChannels,
  TestNotificationChannel,
] as const;
