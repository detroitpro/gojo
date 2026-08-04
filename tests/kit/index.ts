/**
 * Shared test kit for context migrations.
 * Prefer builders + fake ports over full createAppContext boots.
 */
export { FixedClock, SequenceIdGenerator, RecordingOutbox, InMemoryUnitOfWork, ok, err } from "@/kernel";
export type { Clock, IdGenerator, Outbox, UnitOfWork, Result, DomainEvent } from "@/kernel";
