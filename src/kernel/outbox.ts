import type { PlatformEventTopic } from "@shared/events";

import type { DomainEvent } from "./domain-event";

/**
 * Minimal feed port so kernel stays free of platform imports.
 * `PlatformChangeFeed` in `@/platform/events` satisfies this structurally.
 */
export interface ChangeFeedPort {
  append(event: {
    type: string;
    entityKind: string;
    entityId: string;
    projectId?: string;
    topics: PlatformEventTopic[];
    data?: unknown;
  }): unknown;
}

/**
 * Projects domain events onto a durable change feed.
 * Call after the unit of work's DB transaction commits.
 */
export interface Outbox {
  publish(events: readonly DomainEvent[]): void;
}

export class PlatformChangeOutbox implements Outbox {
  constructor(private readonly feed: ChangeFeedPort) {}

  publish(events: readonly DomainEvent[]): void {
    for (const event of events) {
      this.feed.append({
        type: event.type,
        entityKind: event.entityKind,
        entityId: event.entityId,
        ...(event.projectId != null ? { projectId: event.projectId } : {}),
        topics: [...event.topics],
        ...(event.data !== undefined ? { data: event.data } : {}),
      });
    }
  }
}

/** Test double that records published events. */
export class RecordingOutbox implements Outbox {
  readonly published: DomainEvent[] = [];

  publish(events: readonly DomainEvent[]): void {
    this.published.push(...events);
  }
}
