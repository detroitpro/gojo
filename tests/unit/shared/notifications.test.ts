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
});
