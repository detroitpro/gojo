import type { PlatformEventTopic } from "@shared/events";

/**
 * Domain event emitted by a command. Projected onto the platform change feed
 * by the outbox after the unit of work commits.
 */

export type DomainEventTopic = PlatformEventTopic;

export interface DomainEvent {
  /** Stable event name, e.g. "catalog.project.synced". */
  type: string;
  entityKind: string;
  entityId: string;
  projectId?: string | null;
  topics: DomainEventTopic[];
  data?: Record<string, unknown>;
  occurredAt: string;
}

export function domainEvent(
  input: Omit<DomainEvent, "occurredAt"> & { occurredAt?: string },
  clockIso: string,
): DomainEvent {
  return {
    ...input,
    projectId: input.projectId ?? null,
    occurredAt: input.occurredAt ?? clockIso,
  };
}
