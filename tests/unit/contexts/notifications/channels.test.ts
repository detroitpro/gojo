import { describe, expect, test } from "bun:test";

import { testNotificationChannelCommand } from "@/contexts/notifications/application/test-channel";
import {
  buildTestPayload,
  channelSecrets,
} from "@/contexts/notifications/domain/channels";
import type { NotificationDeliveryPort } from "@/contexts/notifications/ports/notification-delivery";
import { FixedClock } from "@/kernel";

describe("contexts/notifications/domain/channels", () => {
  test("buildTestPayload includes finishedAt and marks test:true", () => {
    const payload = buildTestPayload("2026-08-03T00:00:00.000Z");
    expect(payload.test).toBe(true);
    expect(payload.finishedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(payload.state).toBe("Succeeded");
  });

  test("channelSecrets returns botToken for telegram config", () => {
    const secrets = channelSecrets({
      type: "telegram",
      botToken: "bot123:abc",
      chatId: "42",
    });
    expect(secrets).toEqual(["bot123:abc"]);
  });

  test("channelSecrets returns webhookUrl for webhook config", () => {
    const secrets = channelSecrets({
      type: "webhook",
      webhookUrl: "https://hooks.example/xyz",
    });
    expect(secrets).toEqual(["https://hooks.example/xyz"]);
  });

  test("testNotificationChannelCommand validates config and maps delivery errors", async () => {
    const clock = new FixedClock(new Date("2026-08-03T00:00:00.000Z"));
    const delivery: NotificationDeliveryPort = {
      deliverTest: async () => ({ ok: false, message: "webhook unreachable", secrets: ["tok"] }),
    };

    const invalid = await testNotificationChannelCommand({ delivery, clock }, { type: "webhook" });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.message.length).toBeGreaterThan(0);
    }

    const failed = await testNotificationChannelCommand(
      { delivery, clock },
      { type: "webhook", webhookUrl: "https://hooks.example/xyz" },
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.message).toBe("webhook unreachable");
      expect(failed.error.secrets).toEqual(["tok"]);
    }

    const deliveryOk: NotificationDeliveryPort = {
      deliverTest: async () => ({ ok: true }),
    };
    const ok = await testNotificationChannelCommand(
      { delivery: deliveryOk, clock },
      { type: "webhook", webhookUrl: "https://hooks.example/xyz" },
    );
    expect(ok.ok).toBe(true);
  });
});
