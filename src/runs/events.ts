export type RunEvent = {
  type: string;
  runId: string;
  at: string;
  data?: unknown;
};

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
