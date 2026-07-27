import type { PlatformChangeEvent, PlatformEventTopic } from "../types";

export type PlatformEventConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "degraded";

interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

type EventSourceFactory = (url: string) => EventSourceLike;

interface PlatformEventSubscription {
  topics: Set<PlatformEventTopic>;
  projectId?: string;
  listener: (event: PlatformChangeEvent) => void;
}

const CURSOR_KEY = "gojo.platform-events.cursor";

function storedCursor(): number {
  if (typeof window === "undefined") return 0;
  const value = Number(window.sessionStorage.getItem(CURSOR_KEY) ?? "0");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function nativeEventSource(url: string): EventSourceLike {
  return new EventSource(url, { withCredentials: true });
}

export class PlatformEventHub {
  private readonly subscriptions = new Map<number, PlatformEventSubscription>();
  private readonly statusListeners = new Set<(status: PlatformEventConnectionStatus) => void>();
  private source: EventSourceLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextSubscriptionId = 1;
  private retryCount = 0;
  private cursor = storedCursor();
  private currentStatus: PlatformEventConnectionStatus = "idle";

  constructor(
    private readonly createEventSource: EventSourceFactory = nativeEventSource,
    private readonly endpoint = "/api/v1/events",
  ) {}

  get status(): PlatformEventConnectionStatus {
    return this.currentStatus;
  }

  subscribe(
    topics: readonly PlatformEventTopic[],
    listener: (event: PlatformChangeEvent) => void,
    projectId?: string,
  ): () => void {
    const id = this.nextSubscriptionId++;
    this.subscriptions.set(id, { topics: new Set(topics), listener, ...(projectId ? { projectId } : {}) });
    this.connect();
    return () => {
      this.subscriptions.delete(id);
      if (this.subscriptions.size === 0) this.disconnect();
    };
  }

  subscribeStatus(listener: (status: PlatformEventConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => this.statusListeners.delete(listener);
  }

  reconnect(): void {
    if (this.subscriptions.size === 0) return;
    this.closeSource();
    this.connect();
  }

  private connect(): void {
    if (this.source || this.reconnectTimer || this.subscriptions.size === 0) return;
    this.setStatus("connecting");
    const separator = this.endpoint.includes("?") ? "&" : "?";
    const source = this.createEventSource(`${this.endpoint}${separator}after=${this.cursor}`);
    this.source = source;
    source.onopen = () => {
      if (this.source !== source) return;
      this.retryCount = 0;
      this.setStatus("connected");
    };
    source.onmessage = (message) => {
      if (this.source !== source) return;
      try {
        const event = JSON.parse(message.data) as PlatformChangeEvent;
        if (!Number.isInteger(event.sequence) || event.sequence <= this.cursor) return;
        this.cursor = event.sequence;
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(CURSOR_KEY, String(this.cursor));
        }
        for (const subscription of this.subscriptions.values()) {
          if (subscription.projectId && event.projectId !== subscription.projectId) continue;
          if (
            subscription.topics.size > 0 &&
            !event.topics.some((topic) => subscription.topics.has(topic))
          ) {
            continue;
          }
          subscription.listener(event);
        }
      } catch {
        // Ignore malformed events; the durable cursor remains at the last valid event.
      }
    };
    source.onerror = () => {
      if (this.source !== source) return;
      this.closeSource();
      this.setStatus("degraded");
      this.retryCount += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.retryCount - 1, 5));
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    };
  }

  private disconnect(): void {
    this.closeSource();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.retryCount = 0;
    this.setStatus("idle");
  }

  private closeSource(): void {
    this.source?.close();
    this.source = null;
  }

  private setStatus(status: PlatformEventConnectionStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

export const platformEventHub = new PlatformEventHub();
