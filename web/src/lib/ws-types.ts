/**
 * Browser-side wire types mirroring src/shared/ws.ts and src/shared/events.ts.
 * Kept as plain types (no zod) so the Vite bundle stays free of daemon deps.
 * Alias @shared is preferred for imports once configured; this file remains the
 * runtime-safe mirror for the web package.
 */

export type PlatformEventTopic =
  | "dashboard"
  | "overview"
  | "impact"
  | "queue"
  | "runs"
  | "agents"
  | "schedules"
  | "projects"
  | "work"
  | "sources";

export interface PlatformChangeEvent {
  sequence: number;
  id: string;
  projectId: string | null;
  type: string;
  entityKind: string;
  entityId: string;
  topics: PlatformEventTopic[];
  data: unknown;
  occurredAt: string;
  createdAt: string;
}

export type WsHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RunEventCursor = {
  durable: number;
  live: number;
};

export type RunEvent = {
  id?: number;
  idSpace?: "durable" | "live";
  type: string;
  runId: string;
  at: string;
  data?: unknown;
};

export type ClientFrame =
  | { t: "req"; id: number; method: WsHttpMethod; path: string; body?: unknown }
  | {
      t: "sub";
      id: number;
      channel: "platform";
      topics?: PlatformEventTopic[];
      projectId?: string | null;
      after?: number;
    }
  | {
      t: "sub";
      id: number;
      channel: "run";
      runId: string;
      after?: RunEventCursor;
    }
  | { t: "unsub"; id: number };

export type ServerFrame =
  | { t: "hello"; user: { id: string; username: string }; version: string }
  | { t: "res"; id: number; ok: true; data: unknown }
  | {
      t: "res";
      id: number;
      ok: false;
      status: number;
      error: { code: string; message: string };
    }
  | { t: "event"; sub: number; channel: "platform"; event: PlatformChangeEvent }
  | { t: "event"; sub: number; channel: "run"; events: RunEvent[] }
  | { t: "end"; sub: number; reason: "run_finished" };
