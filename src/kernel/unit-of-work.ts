import type { DomainEvent } from "./domain-event";

/**
 * Transaction boundary for a command. Collects domain events; an outbox
 * flushes them after commit.
 */

export interface UnitOfWork {
  addEvent(event: DomainEvent): void;
  events(): readonly DomainEvent[];
  clearEvents(): void;
}

export class InMemoryUnitOfWork implements UnitOfWork {
  private readonly collected: DomainEvent[] = [];

  addEvent(event: DomainEvent): void {
    this.collected.push(event);
  }

  events(): readonly DomainEvent[] {
    return this.collected;
  }

  clearEvents(): void {
    this.collected.length = 0;
  }
}
