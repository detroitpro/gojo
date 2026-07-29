import type { PlatformChangeEvent, PlatformEventTopic } from "./events";

/** HTTP methods allowed on the WebSocket RPC channel. */
export type WsHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Cursor for the run event channel — durable and live id spaces are independent. */
export type RunEventCursor = {
  durable: number;
  live: number;
};

/** Run activity event pushed over the WebSocket run channel. */
export type RunEvent = {
  /**
   * Monotonic id within its namespace (`durable` = work_events.sequence,
   * `live` = in-process RunEventHistory id).
   */
  id?: number;
  /** Which id namespace `id` belongs to. Required when `id` is set. */
  idSpace?: "durable" | "live";
  type: string;
  runId: string;
  at: string;
  data?: unknown;
};

export type ClientReqFrame = {
  t: "req";
  id: number;
  method: WsHttpMethod;
  path: string;
  body?: unknown;
};

export type ClientPlatformSubFrame = {
  t: "sub";
  id: number;
  channel: "platform";
  topics?: PlatformEventTopic[];
  projectId?: string | null;
  after?: number;
};

export type ClientRunSubFrame = {
  t: "sub";
  id: number;
  channel: "run";
  runId: string;
  after?: RunEventCursor;
};

export type ClientUnsubFrame = {
  t: "unsub";
  id: number;
};

export type ClientFrame =
  | ClientReqFrame
  | ClientPlatformSubFrame
  | ClientRunSubFrame
  | ClientUnsubFrame;

export type ServerHelloFrame = {
  t: "hello";
  user: { id: string; username: string };
  version: string;
};

export type ServerOkResFrame = {
  t: "res";
  id: number;
  ok: true;
  data: unknown;
};

export type ServerErrResFrame = {
  t: "res";
  id: number;
  ok: false;
  status: number;
  error: { code: string; message: string };
};

export type ServerResFrame = ServerOkResFrame | ServerErrResFrame;

export type ServerPlatformEventFrame = {
  t: "event";
  sub: number;
  channel: "platform";
  event: PlatformChangeEvent;
};

export type ServerRunEventFrame = {
  t: "event";
  sub: number;
  channel: "run";
  events: RunEvent[];
};

export type ServerEndFrame = {
  t: "end";
  sub: number;
  reason: "run_finished";
};

export type ServerFrame =
  | ServerHelloFrame
  | ServerResFrame
  | ServerPlatformEventFrame
  | ServerRunEventFrame
  | ServerEndFrame;

export const WS_PROTOCOL_VERSION = "0.1.0";
export const WS_PATH = "/api/v1/ws";
