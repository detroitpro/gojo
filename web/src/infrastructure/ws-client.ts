import type {
  ClientFrame,
  PlatformChangeEvent,
  PlatformEventTopic,
  RunEvent,
  RunEventCursor,
  ServerFrame,
  WsHttpMethod,
} from "@gojo/contracts/types";

export type SocketConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "degraded";

export type ReauthListener = () => void;

type PendingRequest = {
  resolve: (value: { ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PlatformSub = {
  id: number;
  topics: Set<PlatformEventTopic>;
  projectId?: string;
  after: number;
  listener: (event: PlatformChangeEvent) => void;
};

type RunSub = {
  id: number;
  runId: string;
  after: RunEventCursor;
  listener: (event: RunEvent) => void;
  onEnd?: () => void;
  onError?: (error: Event) => void;
};

const REQUEST_TIMEOUT_MS = 30_000;
const CURSOR_KEY = "gojo.platform-events.cursor";

function wsUrl(path = "/api/v1/ws"): string {
  if (typeof window === "undefined") return `ws://127.0.0.1:7430${path}`;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

function storedPlatformCursor(): number {
  if (typeof window === "undefined") return 0;
  const value = Number(window.sessionStorage.getItem(CURSOR_KEY) ?? "0");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function persistPlatformCursor(cursor: number): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CURSOR_KEY, String(cursor));
}

export type WebSocketFactory = (url: string) => WebSocket;

export class GojoSocket {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private nextId = 1;
  private currentStatus: SocketConnectionStatus = "idle";
  private readonly statusListeners = new Set<(status: SocketConnectionStatus) => void>();
  private readonly reauthListeners = new Set<ReauthListener>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly platformSubs = new Map<number, PlatformSub>();
  private readonly runSubs = new Map<number, RunSub>();
  private intentionalClose = false;

  constructor(
    private readonly createWebSocket: WebSocketFactory = (url) => new WebSocket(url),
    private readonly endpoint = "/api/v1/ws",
  ) {}

  get status(): SocketConnectionStatus {
    return this.currentStatus;
  }

  get connected(): boolean {
    return this.currentStatus === "connected" && this.socket?.readyState === WebSocket.OPEN;
  }

  subscribeStatus(listener: (status: SocketConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => this.statusListeners.delete(listener);
  }

  onReauth(listener: ReauthListener): () => void {
    this.reauthListeners.add(listener);
    return () => this.reauthListeners.delete(listener);
  }

  connect(): void {
    this.intentionalClose = false;
    this.ensureConnected();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.closeSocket();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.retryCount = 0;
    this.rejectAllPending(new Error("WebSocket disconnected"));
    this.setStatus("idle");
  }

  reconnect(): void {
    if (this.platformSubs.size === 0 && this.runSubs.size === 0 && this.pending.size === 0) {
      return;
    }
    this.intentionalClose = false;
    this.closeSocket();
    this.ensureConnected();
  }

  subscribePlatform(
    topics: readonly PlatformEventTopic[],
    listener: (event: PlatformChangeEvent) => void,
    projectId?: string,
  ): () => void {
    const id = this.nextId++;
    const sub: PlatformSub = {
      id,
      topics: new Set(topics),
      ...(projectId ? { projectId } : {}),
      after: storedPlatformCursor(),
      listener,
    };
    this.platformSubs.set(id, sub);
    this.ensureConnected();
    if (this.connected) void this.sendPlatformSub(sub);
    return () => {
      this.platformSubs.delete(id);
      if (this.connected) {
        void this.send({ t: "unsub", id });
      }
      this.maybeIdle();
    };
  }

  subscribeRun(
    runId: string,
    onEvent: (event: RunEvent) => void,
    onError?: (error: Event) => void,
    onEnd?: () => void,
  ): () => void {
    const id = this.nextId++;
    const sub: RunSub = {
      id,
      runId,
      after: { durable: 0, live: 0 },
      listener: onEvent,
      ...(onError ? { onError } : {}),
      ...(onEnd ? { onEnd } : {}),
    };
    this.runSubs.set(id, sub);
    this.ensureConnected();
    if (this.connected) void this.sendRunSub(sub);
    return () => {
      this.runSubs.delete(id);
      if (this.connected) {
        void this.send({ t: "unsub", id });
      }
      this.maybeIdle();
    };
  }

  async request(
    method: WsHttpMethod,
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: { code: string; message: string } }> {
    this.ensureConnected();
    if (!this.connected) {
      throw new Error("WebSocket not connected");
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const frame: ClientFrame = {
        t: "req",
        id,
        method,
        path: path.startsWith("/api/v1") ? path : `/api/v1${path.startsWith("/") ? path : `/${path}`}`,
        ...(body !== undefined ? { body } : {}),
      };
      try {
        this.socket!.send(JSON.stringify(frame));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private ensureConnected(): void {
    if (this.socket || this.reconnectTimer || this.intentionalClose) return;
    this.setStatus("connecting");
    const socket = this.createWebSocket(wsUrl(this.endpoint));
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.retryCount = 0;
      // Wait for hello before marking connected / re-subscribing.
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(String(event.data));
    };

    socket.onerror = () => {
      // onclose follows; status updated there.
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.rejectAllPending(new Error("WebSocket closed"));
      if (this.intentionalClose) {
        this.setStatus("idle");
        return;
      }
      this.setStatus("degraded");
      this.retryCount += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.retryCount - 1, 5));
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.ensureConnected();
      }, delay);
    };

    if (typeof window !== "undefined" && import.meta.env?.DEV) {
      (window as unknown as { __gojoSocket?: GojoSocket }).__gojoSocket = this;
    }
  }

  private handleMessage(raw: string): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(raw) as ServerFrame;
    } catch {
      return;
    }

    if (frame.t === "hello") {
      this.setStatus("connected");
      void this.resubscribeAll();
      return;
    }

    if (frame.t === "res") {
      if (frame.ok === false && frame.status === 401) {
        for (const listener of this.reauthListeners) listener();
      }
      const pending = this.pending.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);
        if (frame.ok) {
          pending.resolve({ ok: true, data: frame.data });
        } else {
          pending.resolve({
            ok: false,
            status: frame.status,
            error: frame.error,
          });
        }
      }
      return;
    }

    if (frame.t === "event") {
      if (frame.channel === "platform") {
        const sub = this.platformSubs.get(frame.sub);
        if (!sub) return;
        if (frame.event.sequence <= sub.after) return;
        if (sub.projectId && frame.event.projectId !== sub.projectId) return;
        if (
          sub.topics.size > 0 &&
          !frame.event.topics.some((topic) => sub.topics.has(topic))
        ) {
          return;
        }
        sub.after = frame.event.sequence;
        persistPlatformCursor(frame.event.sequence);
        sub.listener(frame.event);
        return;
      }
      if (frame.channel === "run") {
        const sub = this.runSubs.get(frame.sub);
        if (!sub) return;
        for (const event of frame.events) {
          if (event.id != null && event.idSpace === "durable") {
            sub.after = { ...sub.after, durable: Math.max(sub.after.durable, event.id) };
          } else if (event.id != null) {
            sub.after = { ...sub.after, live: Math.max(sub.after.live, event.id) };
          }
          sub.listener(event);
        }
      }
      return;
    }

    if (frame.t === "end") {
      const sub = this.runSubs.get(frame.sub);
      if (!sub) return;
      sub.onEnd?.();
      this.runSubs.delete(frame.sub);
      this.maybeIdle();
    }
  }

  private async resubscribeAll(): Promise<void> {
    for (const sub of this.platformSubs.values()) {
      await this.sendPlatformSub(sub);
    }
    for (const sub of this.runSubs.values()) {
      await this.sendRunSub(sub);
    }
  }

  private async sendPlatformSub(sub: PlatformSub): Promise<void> {
    const frame: ClientFrame = {
      t: "sub",
      id: sub.id,
      channel: "platform",
      after: sub.after,
      ...(sub.topics.size ? { topics: [...sub.topics] } : {}),
      ...(sub.projectId ? { projectId: sub.projectId } : {}),
    };
    this.send(frame);
  }

  private async sendRunSub(sub: RunSub): Promise<void> {
    const frame: ClientFrame = {
      t: "sub",
      id: sub.id,
      channel: "run",
      runId: sub.runId,
      after: sub.after,
    };
    this.send(frame);
  }

  private send(frame: ClientFrame): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(frame));
  }

  private closeSocket(): void {
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private maybeIdle(): void {
    if (
      this.platformSubs.size === 0 &&
      this.runSubs.size === 0 &&
      this.pending.size === 0 &&
      !this.intentionalClose
    ) {
      // Keep the socket open while the app is authenticated; idle only on disconnect().
    }
  }

  private setStatus(status: SocketConnectionStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

export const gojoSocket = new GojoSocket();
