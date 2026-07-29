import type { PlatformChangeEvent, PlatformEventTopic } from "@shared/events";

export interface PlatformEventStreamFilter {
  projectId?: string | null;
  topics?: PlatformEventTopic[];
}

export function matchesPlatformEvent(
  event: PlatformChangeEvent,
  filter: PlatformEventStreamFilter,
): boolean {
  if (filter.projectId !== undefined && event.projectId !== filter.projectId) {
    return false;
  }
  if (filter.topics?.length && !event.topics.some((topic) => filter.topics?.includes(topic))) {
    return false;
  }
  return true;
}

export function sequenceFromRequest(request: Request): number {
  const url = new URL(request.url);
  const header = Number(request.headers.get("Last-Event-ID") ?? "0");
  const query = Number(url.searchParams.get("after") ?? "0");
  return Math.max(
    Number.isFinite(header) ? header : 0,
    Number.isFinite(query) ? query : 0,
  );
}
