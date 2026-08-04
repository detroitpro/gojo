import type { NotificationChannelConfig, NotificationChannelMap } from "./types";
import { request } from "@/infrastructure/http";

export async function listNotificationChannels(): Promise<NotificationChannelMap> {
  const { data } = await request<{ channels: NotificationChannelMap }>("/notification-channels");
  return data.channels;
}

export async function putNotificationChannels(
  channels: NotificationChannelMap,
): Promise<NotificationChannelMap> {
  const { data } = await request<{ channels: NotificationChannelMap }>("/notification-channels", {
    method: "PUT",
    body: JSON.stringify(channels),
  });
  return data.channels;
}

export async function testNotificationChannel(
  config: NotificationChannelConfig,
): Promise<{ ok: boolean }> {
  const { data } = await request<{ ok: boolean }>("/notification-channels/test", {
    method: "POST",
    body: JSON.stringify(config),
  });
  return data;
}
