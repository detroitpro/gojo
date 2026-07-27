import { describe, expect, test } from "bun:test";

import { createPlatformEventStream } from "@/events/platform-event-stream";
import { PlatformChangeFeed } from "@/events/platform-change-feed";
import { Database } from "@/storage";

async function readChunk(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const chunk = await reader.read();
  reader.releaseLock();
  return new TextDecoder().decode(chunk.value);
}

describe("createPlatformEventStream", () => {
  test("replays after Last-Event-ID and honors filters", async () => {
    const db = Database.open(":memory:");
    db.migrate();
    const feed = new PlatformChangeFeed(db);
    const first = feed.append({
      projectId: "project-1",
      type: "run.created",
      entityKind: "run",
      entityId: "run-1",
      topics: ["runs"],
    });
    const second = feed.append({
      projectId: "project-1",
      type: "run.state_changed",
      entityKind: "run",
      entityId: "run-1",
      topics: ["dashboard", "queue"],
    });
    feed.append({
      projectId: "project-2",
      type: "run.created",
      entityKind: "run",
      entityId: "run-2",
      topics: ["dashboard"],
    });
    const abort = new AbortController();
    const request = new Request("http://localhost/api/v1/events", {
      headers: { "Last-Event-ID": String(first.sequence) },
      signal: abort.signal,
    });

    const response = createPlatformEventStream(feed, request, {
      projectId: "project-1",
      topics: ["dashboard"],
    });
    const chunk = await readChunk(response);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(chunk).toContain(`id: ${second.sequence}`);
    expect(chunk).toContain('"type":"run.state_changed"');
    expect(chunk).not.toContain('"projectId":"project-2"');
    abort.abort();
    feed.close();
    db.close();
  });

  test("pushes newly appended events without waiting for fallback polling", async () => {
    const db = Database.open(":memory:");
    db.migrate();
    const feed = new PlatformChangeFeed(db);
    const abort = new AbortController();
    const response = createPlatformEventStream(
      feed,
      new Request("http://localhost/api/v1/events", { signal: abort.signal }),
    );
    const read = readChunk(response);

    const event = feed.append({
      type: "instance.paused",
      entityKind: "instance",
      entityId: "instance",
      topics: ["dashboard", "queue"],
    });

    expect(await read).toContain(`id: ${event.sequence}`);
    abort.abort();
    feed.close();
    db.close();
  });
});
