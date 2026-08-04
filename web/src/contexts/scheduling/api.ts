import type { QueueSnapshot, SchedulesUpcomingResult, SchedulingPolicy } from "./types";
import { request } from "@/infrastructure/http";
import { buildListQuery, type ListQuery } from "@/kernel/pagination";

export async function getQueue(query: ListQuery = {}): Promise<QueueSnapshot> {
  const { data } = await request<QueueSnapshot>(`/queue${buildListQuery(query)}`);
  return data;
}

export async function getSchedulingPolicy(): Promise<SchedulingPolicy> {
  const { data } = await request<{ policy: SchedulingPolicy }>("/instance/scheduling");
  return data.policy;
}

export async function updateSchedulingPolicy(
  policy: SchedulingPolicy,
): Promise<SchedulingPolicy> {
  const { data } = await request<{ policy: SchedulingPolicy }>("/instance/scheduling", {
    method: "PATCH",
    body: JSON.stringify(policy),
  });
  return data.policy;
}

export async function listSchedulesUpcoming(query: {
  horizonHours?: number;
  projectId?: string;
  enabled?: "all" | "enabled" | "disabled" | boolean | null;
  q?: string;
} = {}): Promise<SchedulesUpcomingResult> {
  const params = new URLSearchParams();
  if (query.horizonHours != null) {
    params.set("horizonHours", String(query.horizonHours));
  }
  if (query.projectId) {
    params.set("projectId", query.projectId);
  }
  if (query.enabled === "enabled" || query.enabled === true) {
    params.set("enabled", "true");
  } else if (query.enabled === "disabled" || query.enabled === false) {
    params.set("enabled", "false");
  }
  if (query.q?.trim()) {
    params.set("q", query.q.trim());
  }
  const qs = params.toString();
  const { data } = await request<SchedulesUpcomingResult>(
    `/schedules/upcoming${qs ? `?${qs}` : ""}`,
  );
  return data;
}
