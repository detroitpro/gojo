import { randomBytes } from "node:crypto";

export interface Span {
  end(): void;
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: unknown): void;
}

interface SpanRecord {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: Record<string, string | number | boolean>;
  startTime: number;
  endTime?: number;
  exceptions: string[];
}

interface Counter {
  add(n: number, attrs?: Record<string, string | number | boolean>): void;
}

interface Meter {
  counter(name: string): Counter;
}

let enabled = false;
let serviceName = "gojo";
const spans: SpanRecord[] = [];
const counters = new Map<string, number>();

function randomId(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function logEvent(event: Record<string, unknown>): void {
  if (!enabled) {
    return;
  }

  console.error(
    JSON.stringify({
      service: serviceName,
      timestamp: new Date().toISOString(),
      ...event,
    }),
  );
}

class SimpleSpan implements Span {
  private readonly record: SpanRecord;

  constructor(record: SpanRecord) {
    this.record = record;
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.record.attributes[key] = value;
  }

  recordException(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.record.exceptions.push(message);
  }

  end(): void {
    this.record.endTime = Date.now();
    logEvent({
      type: "span",
      name: this.record.name,
      traceId: this.record.traceId,
      spanId: this.record.spanId,
      parentSpanId: this.record.parentSpanId,
      attributes: this.record.attributes,
      durationMs: this.record.endTime - this.record.startTime,
      exceptions: this.record.exceptions,
    });
  }
}

class SimpleCounter implements Counter {
  constructor(private readonly name: string) {}

  add(n: number, attrs?: Record<string, string | number | boolean>): void {
    const current = counters.get(this.name) ?? 0;
    counters.set(this.name, current + n);
    logEvent({
      type: "metric",
      metric: this.name,
      value: n,
      total: current + n,
      attributes: attrs ?? {},
    });
  }
}

class SimpleMeter implements Meter {
  counter(name: string): Counter {
    return new SimpleCounter(name);
  }
}

const meter = new SimpleMeter();

/** Configures telemetry emission for the process. */
export function configureTelemetry(opts: { enabled: boolean; serviceName: string }): void {
  enabled = opts.enabled;
  serviceName = opts.serviceName;
}

/** Starts a span and returns a handle for attribute and lifecycle management. */
export function startSpan(
  name: string,
  attrs?: Record<string, string | number | boolean>,
): Span {
  const record: SpanRecord = {
    name,
    traceId: randomId(16),
    spanId: randomId(8),
    attributes: { ...(attrs ?? {}) },
    startTime: Date.now(),
    exceptions: [],
  };
  spans.push(record);
  return new SimpleSpan(record);
}

/** Returns the process meter for counter metrics. */
export function getMeter(): Meter {
  return meter;
}

/** Test helpers — not part of the public API surface for production callers. */
export function __testing__resetTelemetry(): void {
  enabled = false;
  serviceName = "gojo";
  spans.length = 0;
  counters.clear();
}

export function __testing__getSpanRecords(): readonly SpanRecord[] {
  return spans;
}

export function __testing__getCounterValue(name: string): number {
  return counters.get(name) ?? 0;
}
