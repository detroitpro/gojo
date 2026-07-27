import type {
  CreatePlatformChangeEventInput,
  PlatformChangeEvent,
} from "@shared/events";
import {
  createPlatformChangeEventRepository,
  type Database,
  type ListPlatformChangeEventsInput,
  type PlatformChangeEventRepository,
} from "@/storage";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RETAINED_EVENTS = 50_000;
const PRUNE_EVERY_APPENDS = 1_000;

export class PlatformChangeFeed {
  private readonly repository: PlatformChangeEventRepository;
  private readonly listeners = new Set<(event: PlatformChangeEvent) => void>();
  private appendsSincePrune = 0;

  constructor(db: Database) {
    this.repository = createPlatformChangeEventRepository(db);
    this.pruneExpired();
  }

  append(input: CreatePlatformChangeEventInput): PlatformChangeEvent {
    const event = this.repository.append(input);
    this.appendsSincePrune += 1;
    if (this.appendsSincePrune >= PRUNE_EVERY_APPENDS) this.pruneExpired();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
      }
    }
    return event;
  }

  list(input: ListPlatformChangeEventsInput = {}): PlatformChangeEvent[] {
    return this.repository.list(input);
  }

  subscribe(listener: (event: PlatformChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pruneThrough(sequence: number): number {
    return this.repository.pruneThrough(sequence);
  }

  pruneExpired(now = new Date()): number {
    this.appendsSincePrune = 0;
    const before = new Date(now.getTime() - RETENTION_MS).toISOString();
    return (
      this.repository.pruneBefore(before) +
      this.repository.pruneToLatest(MAX_RETAINED_EVENTS)
    );
  }

  close(): void {
    this.listeners.clear();
  }
}
