import { describe, expect, test } from "bun:test";

import {
  NotificationChannelMapSchema,
  safeParseNotificationChannelConfig,
  safeParseNotificationChannelMap,
} from "@shared/notifications";

describe("shared/notifications", () => {
  test("accepts a valid channel map", () => {
    const parsed = NotificationChannelMapSchema.parse({
      eng: { type: "slack", webhookUrl: "https://hooks.slack.com/services/T/B/X" },
      ops: { type: "webhook", webhookUrl: "https://example.test/hook" },
    });
    expect(Object.keys(parsed)).toEqual(["eng", "ops"]);
  });

  test("rejects missing type", () => {
    const result = safeParseNotificationChannelMap({
      eng: { webhookUrl: "https://example.test/hook" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid webhook URL", () => {
    const result = safeParseNotificationChannelConfig({
      type: "webhook",
      webhookUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown channel type", () => {
    const result = safeParseNotificationChannelConfig({
      type: "email",
      webhookUrl: "https://example.test/hook",
    });
    expect(result.success).toBe(false);
  });

  test("accepts telegram with botToken and chatId", () => {
    const result = safeParseNotificationChannelConfig({
      type: "telegram",
      botToken: "123456:ABC-DEF",
      chatId: "-1001234567890",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        type: "telegram",
        botToken: "123456:ABC-DEF",
        chatId: "-1001234567890",
      });
    }
  });

  test("coerces numeric telegram chatId to string", () => {
    const result = safeParseNotificationChannelConfig({
      type: "telegram",
      botToken: "123456:ABC",
      chatId: -1001,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "telegram") {
      expect(result.data.chatId).toBe("-1001");
    }
  });

  test("rejects telegram that only has webhookUrl", () => {
    const result = safeParseNotificationChannelConfig({
      type: "telegram",
      webhookUrl: "https://example.test/hook",
    });
    expect(result.success).toBe(false);
  });

  test("rejects slack without webhookUrl", () => {
    const result = safeParseNotificationChannelConfig({
      type: "slack",
      botToken: "nope",
      chatId: "1",
    });
    expect(result.success).toBe(false);
  });
});
