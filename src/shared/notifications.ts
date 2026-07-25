import { z } from "zod";

export const NotificationChannelTypeSchema = z.enum([
  "slack",
  "webhook",
  "discord",
  "teams",
  "telegram",
]);

const WebhookLikeChannelConfigSchema = z.object({
  type: z.enum(["slack", "webhook", "discord", "teams"]),
  webhookUrl: z.string().url(),
  config: z.record(z.unknown()).optional(),
});

const TelegramChannelConfigSchema = z.object({
  type: z.literal("telegram"),
  botToken: z.string().min(1),
  chatId: z.union([z.string().min(1), z.number()]).transform((value) => String(value)),
  config: z.record(z.unknown()).optional(),
});

export const NotificationChannelConfigSchema = z.union([
  WebhookLikeChannelConfigSchema,
  TelegramChannelConfigSchema,
]);

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

export function isTelegramChannel(
  config: NotificationChannelConfig,
): config is Extract<NotificationChannelConfig, { type: "telegram" }> {
  return config.type === "telegram";
}

export function isWebhookLikeChannel(
  config: NotificationChannelConfig,
): config is Extract<NotificationChannelConfig, { webhookUrl: string }> {
  return config.type !== "telegram";
}
