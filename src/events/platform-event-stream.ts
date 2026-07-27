import type { PlatformChangeEvent, PlatformEventTopic } from "@shared/events";

import type { PlatformChangeFeed } from "./platform-change-feed";

const REPLAY_LIMIT = 500;
const FALLBACK_INTERVAL_MS = 5_000;
const KEEPALIVE_INTERVAL_MS = 15_000;

export interface PlatformEventStreamFilter {
  projectId?: string | null;
  topics?: PlatformEventTopic[];
}

function sequenceFrom(request: Request): number {
  const url = new URL(request.url);
  const header = Number(request.headers.get("Last-Event-ID") ?? "0");
  const query = Number(url.searchParams.get("after") ?? "0");
  return Math.max(
    Number.isFinite(header) ? header : 0,
    Number.isFinite(query) ? query : 0,
  );
}

function matches(event: PlatformChangeEvent, filter: PlatformEventStreamFilter): boolean {
  if (filter.projectId !== undefined && event.projectId !== filter.projectId) return false;
  if (filter.topics?.length && !event.topics.some((topic) => filter.topics?.includes(topic))) {
    return false;
  }
  return true;
}

export function createPlatformEventStream(
  feed: PlatformChangeFeed,
  request: Request,
  filter: PlatformEventStreamFilter = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let sequence = sequenceFrom(request);
      let closed = false;
      const send = (event: PlatformChangeEvent) => {
        if (closed || event.sequence <= sequence || !matches(event, filter)) return;
        sequence = event.sequence;
        controller.enqueue(
          encoder.encode(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      };
      const replay = () => {
        if (closed) return;
        const events = feed.list({
          afterSequence: sequence,
          limit: REPLAY_LIMIT,
          ...(filter.projectId !== undefined ? { projectId: filter.projectId } : {}),
          ...(filter.topics?.length ? { topics: filter.topics } : {}),
        });
        for (const event of events) send(event);
      };
      const unsubscribe = feed.subscribe(send);
      replay();
      const fallback = setInterval(replay, FALLBACK_INTERVAL_MS);
      const keepalive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
      }, KEEPALIVE_INTERVAL_MS);
      request.signal.addEventListener(
        "abort",
        () => {
          closed = true;
          unsubscribe();
          clearInterval(fallback);
          clearInterval(keepalive);
          try {
            controller.close();
          } catch {
            // already closed
          }
        },
        { once: true },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
