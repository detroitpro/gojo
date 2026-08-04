import { describe, expect, test } from "bun:test";

import {
  buildTestPayload,
  channelSecrets,
} from "@/contexts/notifications/domain/channels";

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
});
