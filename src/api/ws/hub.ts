import type { AppContext } from "@/app/context";
import type { PlatformChangeEvent, PlatformEventTopic } from "@shared/events";
import type {
  ClientPlatformSubFrame,
  ClientRunSubFrame,
  RunEvent,
  RunEventCursor,
  ServerFrame,
} from "@shared/ws";
import { matchesPlatformEvent } from "@/events/platform-event-filter";
import { replayRunEvents, tagLiveRunEvent } from "@/runs/event-replay";

const PLATFORM_REPLAY_LIMIT = 500;
const FALLBACK_INTERVAL_MS = 5_000;
const RUN_BATCH_MS = 50;

export type WsSocket = {
  send(message: string | ArrayBuffer | Uint8Array, compress?: boolean): number;
  close(code?: number, reason?: string): void;
  data: unknown;
};

type PlatformSubscription = {
  kind: "platform";
  id: number;
  socket: WsSocket;
  topics: PlatformEventTopic[];
  projectId?: string | null;
  sequence: number;
};

type RunSubscription = {
  kind: "run";
  id: number;
  socket: WsSocket;
  runId: string;
  cursor: RunEventCursor;
  seenDurable: Set<number>;
  seenLive: Set<number>;
  batch: RunEvent[];
  batchTimer: ReturnType<typeof setTimeout> | null;
  ended: boolean;
};

type Subscription = PlatformSubscription | RunSubscription;

function sendFrame(socket: WsSocket, frame: ServerFrame): number {
  return socket.send(JSON.stringify(frame));
}

export class WsHub {
  private readonly subscriptions = new Map<number, Subscription>();
  private readonly sockets = new Set<WsSocket>();
  private unsubscribeFeed: (() => void) | null = null;
  private unsubscribeBus: (() => void) | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private nextLocalId = 1;

  constructor(private readonly ctx: AppContext) {}

  attach(socket: WsSocket): void {
    this.sockets.add(socket);
  }

  detach(socket: WsSocket): void {
    for (const [id, sub] of this.subscriptions) {
      if (sub.socket === socket) {
        this.clearRunBatch(sub);
        this.subscriptions.delete(id);
      }
    }
    this.sockets.delete(socket);
    this.syncFeedListeners();
  }

  subscribePlatform(socket: WsSocket, frame: ClientPlatformSubFrame): void {
    const sub: PlatformSubscription = {
      kind: "platform",
      id: frame.id,
      socket,
      topics: frame.topics ?? [],
      ...(frame.projectId !== undefined ? { projectId: frame.projectId } : {}),
      sequence: frame.after ?? 0,
    };
    this.subscriptions.set(frame.id, sub);
    this.syncFeedListeners();
    this.replayPlatform(sub);
  }

  subscribeRun(socket: WsSocket, frame: ClientRunSubFrame): { ok: true } | { ok: false; error: string; status: number } {
    const run = this.ctx.repos.runs.findById(frame.runId);
    if (!run) {
      return { ok: false, error: "Run not found", status: 404 };
    }

    const sub: RunSubscription = {
      kind: "run",
      id: frame.id,
      socket,
      runId: frame.runId,
      cursor: frame.after ?? { durable: 0, live: 0 },
      seenDurable: new Set(),
      seenLive: new Set(),
      batch: [],
      batchTimer: null,
      ended: false,
    };
    this.subscriptions.set(frame.id, sub);
    this.syncFeedListeners();

    const replayed = replayRunEvents({
      runId: frame.runId,
      workItemId: run.workItemId,
      after: sub.cursor,
      listDurable: (workItemId, afterSequence) =>
        this.ctx.work.events.listByWorkItem(workItemId, afterSequence).map((row) => ({
          sequence: row.sequence,
          type: row.type,
          occurredAt: row.occurredAt,
          dataJson: row.dataJson,
        })),
      eventHistory: this.ctx.eventHistory,
    });

    for (const event of replayed.events) {
      this.deliverRunEvent(sub, event, true);
      if (sub.ended) break;
    }
    sub.cursor = replayed.cursor;
    this.flushRunBatch(sub);

    if (replayed.finished || sub.ended) {
      this.endRun(sub);
    }
    return { ok: true };
  }

  unsubscribe(id: number): boolean {
    const sub = this.subscriptions.get(id);
    if (!sub) return false;
    this.clearRunBatch(sub);
    this.subscriptions.delete(id);
    this.syncFeedListeners();
    return true;
  }

  close(): void {
    for (const sub of this.subscriptions.values()) this.clearRunBatch(sub);
    this.subscriptions.clear();
    this.sockets.clear();
    this.teardownFeedListeners();
  }

  /** Test helper: number of active subscriptions. */
  get subscriptionCount(): number {
    return this.subscriptions.size;
  }

  /** Test helper: whether the shared fallback timer is running. */
  get fallbackActive(): boolean {
    return this.fallbackTimer != null;
  }

  private syncFeedListeners(): void {
    const hasPlatform = [...this.subscriptions.values()].some((s) => s.kind === "platform");
    const hasRun = [...this.subscriptions.values()].some((s) => s.kind === "run");

    if (hasPlatform || hasRun) {
      if (!this.unsubscribeFeed) {
        this.unsubscribeFeed = this.ctx.platformEvents.subscribe((event) => {
          this.onPlatformEvent(event);
        });
      }
      if (!this.fallbackTimer) {
        this.fallbackTimer = setInterval(() => this.repairPlatform(), FALLBACK_INTERVAL_MS);
      }
    } else {
      this.teardownFeedListeners();
    }

    if (hasRun) {
      if (!this.unsubscribeBus) {
        this.unsubscribeBus = this.ctx.eventBus.subscribe((event) => {
          this.onRunBusEvent(event);
        });
      }
    } else if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
  }

  private teardownFeedListeners(): void {
    if (this.unsubscribeFeed) {
      this.unsubscribeFeed();
      this.unsubscribeFeed = null;
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
  }

  private onPlatformEvent(event: PlatformChangeEvent): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.kind !== "platform") continue;
      this.deliverPlatform(sub, event);
    }
  }

  private repairPlatform(): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.kind !== "platform") continue;
      this.replayPlatform(sub);
    }
  }

  private replayPlatform(sub: PlatformSubscription): void {
    const events = this.ctx.platformEvents.list({
      afterSequence: sub.sequence,
      limit: PLATFORM_REPLAY_LIMIT,
      ...(sub.projectId !== undefined ? { projectId: sub.projectId } : {}),
      ...(sub.topics.length ? { topics: sub.topics } : {}),
    });
    for (const event of events) this.deliverPlatform(sub, event);
  }

  private deliverPlatform(sub: PlatformSubscription, event: PlatformChangeEvent): void {
    if (event.sequence <= sub.sequence) return;
    if (
      !matchesPlatformEvent(event, {
        ...(sub.projectId !== undefined ? { projectId: sub.projectId } : {}),
        ...(sub.topics.length ? { topics: sub.topics } : {}),
      })
    ) {
      return;
    }
    sub.sequence = event.sequence;
    const result = sendFrame(sub.socket, {
      t: "event",
      sub: sub.id,
      channel: "platform",
      event,
    });
    if (result === 0) {
      // Connection gone — detach will clean up.
    }
  }

  private onRunBusEvent(event: RunEvent): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.kind !== "run" || sub.runId !== event.runId || sub.ended) continue;
      this.deliverRunEvent(sub, tagLiveRunEvent(event), false);
    }
  }

  private deliverRunEvent(sub: RunSubscription, event: RunEvent, immediate: boolean): void {
    if (sub.ended || event.runId !== sub.runId) return;

    const space = event.idSpace ?? "live";
    if (event.id != null) {
      const seen = space === "durable" ? sub.seenDurable : sub.seenLive;
      if (seen.has(event.id)) return;
      seen.add(event.id);
      if (space === "durable") {
        sub.cursor = { ...sub.cursor, durable: Math.max(sub.cursor.durable, event.id) };
      } else {
        sub.cursor = { ...sub.cursor, live: Math.max(sub.cursor.live, event.id) };
      }
    }

    if (event.type === "run.agent.output" && !immediate) {
      sub.batch.push(event);
      if (!sub.batchTimer) {
        sub.batchTimer = setTimeout(() => {
          sub.batchTimer = null;
          this.flushRunBatch(sub);
        }, RUN_BATCH_MS);
      }
    } else {
      this.flushRunBatch(sub);
      const result = sendFrame(sub.socket, {
        t: "event",
        sub: sub.id,
        channel: "run",
        events: [event],
      });
      // Drop output under backpressure; never drop lifecycle events.
      if (result === -1 && event.type === "run.agent.output") {
        // already sent — ignore
      }
      if (event.type === "run.finished") {
        this.endRun(sub);
      }
    }
  }

  private flushRunBatch(sub: Subscription): void {
    if (sub.kind !== "run" || sub.batch.length === 0) return;
    const events = sub.batch;
    sub.batch = [];
    if (sub.batchTimer) {
      clearTimeout(sub.batchTimer);
      sub.batchTimer = null;
    }
    const result = sendFrame(sub.socket, {
      t: "event",
      sub: sub.id,
      channel: "run",
      events,
    });
    // Under backpressure, drop further output batches (lossy by design).
    if (result === -1) {
      sub.batch = [];
    }
  }

  private clearRunBatch(sub: Subscription): void {
    if (sub.kind !== "run") return;
    if (sub.batchTimer) clearTimeout(sub.batchTimer);
    sub.batchTimer = null;
    sub.batch = [];
  }

  private endRun(sub: RunSubscription): void {
    if (sub.ended) return;
    this.flushRunBatch(sub);
    sub.ended = true;
    sendFrame(sub.socket, { t: "end", sub: sub.id, reason: "run_finished" });
    this.subscriptions.delete(sub.id);
    this.syncFeedListeners();
  }

  /** Allocate a unique internal id (unused externally; client ids are authoritative). */
  allocateId(): number {
    return this.nextLocalId++;
  }
}
