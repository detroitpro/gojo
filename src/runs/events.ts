export type RunEvent = {
  /** Monotonic id within the process (for SSE Last-Event-ID / client dedupe). */
  id?: number;
  type: string;
  runId: string;
  at: string;
  data?: unknown;
};

const PINNED_TYPES = new Set([
  'run.created',
  'run.state_changed',
  'run.agent.model',
  'run.agent.finished',
  'run.failed',
  'run.finished',
  'run.awaiting_approval',
  'run.artifact_written',
  'run.validation.step',
  'run.agent.tool',
]);

function isOutputEvent(event: RunEvent): boolean {
  return event.type === 'run.agent.output';
}

/**
 * In-memory per-run event log for SSE replay.
 * Prefer dropping output chunks when over capacity so early model/state survive.
 */
export class RunEventHistory {
  private readonly events = new Map<string, RunEvent[]>();
  private readonly maxPerRun: number;
  private nextId = 1;

  constructor(maxPerRun = 500) {
    this.maxPerRun = maxPerRun;
  }

  /** Assigns a monotonic `id` in place so later bus subscribers see it. */
  record(event: RunEvent): void {
    if (event.id == null) {
      event.id = this.nextId++;
    } else {
      this.nextId = Math.max(this.nextId, event.id + 1);
    }
    const list = this.events.get(event.runId) ?? [];
    list.push(event);
    this.trim(list);
    this.events.set(event.runId, list);
  }

  list(runId: string, afterId?: number): RunEvent[] {
    const list = this.events.get(runId) ?? [];
    if (afterId == null || !Number.isFinite(afterId)) {
      return [...list];
    }
    return list.filter((event) => (event.id ?? 0) > afterId);
  }

  clear(): void {
    this.events.clear();
  }

  private trim(list: RunEvent[]): void {
    while (list.length > this.maxPerRun) {
      const outputIdx = list.findIndex((event) => isOutputEvent(event));
      if (outputIdx >= 0) {
        list.splice(outputIdx, 1);
        continue;
      }
      // No output left — drop oldest non-pinned, else oldest anything.
      const dropIdx = list.findIndex((event) => !PINNED_TYPES.has(event.type));
      list.splice(dropIdx >= 0 ? dropIdx : 0, 1);
    }
  }
}

export class RunEventBus extends EventTarget {
  emit(event: RunEvent): void {
    this.dispatchEvent(new CustomEvent('run', { detail: event }));
  }

  subscribe(listener: (event: RunEvent) => void): () => void {
    const handler = (event: Event): void => {
      listener((event as CustomEvent<RunEvent>).detail);
    };
    this.addEventListener('run', handler);
    return () => {
      this.removeEventListener('run', handler);
    };
  }
}
