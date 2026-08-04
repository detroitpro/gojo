/**
 * Pure domain-event helpers for the catalog context.
 * The application layer wraps each helper with clock/uow so tests can assert
 * emission without touching SQLite.
 */

import type { DomainEventTopic } from "@/kernel";

export const PROJECT_SYNCED_TOPICS: DomainEventTopic[] = [
  "dashboard",
  "overview",
  "projects",
  "agents",
  "schedules",
  "work",
  "sources",
];

export const AGENT_UPDATED_TOPICS: DomainEventTopic[] = [
  "dashboard",
  "overview",
  "projects",
  "agents",
];

export const SCHEDULE_UPDATED_TOPICS: DomainEventTopic[] = [
  "dashboard",
  "overview",
  "projects",
  "schedules",
];

export const PROJECT_DELETED_TOPICS: DomainEventTopic[] = [
  "dashboard",
  "overview",
  "impact",
  "projects",
];
