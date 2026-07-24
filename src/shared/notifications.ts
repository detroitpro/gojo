import { z } from "zod";

export const NotificationChannelTypeSchema = z.enum([
  "slack",
  "webhook",
  "discord",
  "teams",
  "telegram",
]);

export const NotificationChannelConfigSchema = z.object({
  type: NotificationChannelTypeSchema,
  webhookUrl: z.string().url(),
  config: z.record(z.unknown()).optional(),
});

export const NotificationChannelMapSchema = z.record(NotificationChannelConfigSchema);

export type NotificationChannelType = z.infer<typeof NotificationChannelTypeSchema>;
export type NotificationChannelConfig = z.infer<typeof NotificationChannelConfigSchema>;
export type NotificationChannelMap = z.infer<typeof NotificationChannelMapSchema>;

export function parseNotificationChannelMap(input: unknown): NotificationChannelMap {
  return NotificationChannelMapSchema.parse(input);
}

export function safeParseNotificationChannelMap(input: unknown) {
  return NotificationChannelMapSchema.safeParse(input);
}

export function parseNotificationChannelConfig(input: unknown): NotificationChannelConfig {
  return NotificationChannelConfigSchema.parse(input);
}

export function safeParseNotificationChannelConfig(input: unknown) {
  return NotificationChannelConfigSchema.safeParse(input);
}
