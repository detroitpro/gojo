import { describe, expect, test } from "bun:test";

import { PlatformChangeFeed } from "@/platform/events/platform-change-feed";
import { Database } from "@/infrastructure/persistence";

describe("PlatformChangeFeed", () => {
  test("persists changes and wakes live subscribers", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const feed = new PlatformChangeFeed(db);
    const received: number[] = [];
    const unsubscribe = feed.subscribe((event) => received.push(event.sequence));

    const event = feed.append({
      projectId: "project-1",
      type: "run.created",
      entityKind: "run",
      entityId: "run-1",
      topics: ["dashboard", "queue", "runs"],
    });

    expect(received).toEqual([event.sequence]);
    expect(feed.list({ afterSequence: 0 })).toEqual([event]);
    unsubscribe();
    feed.append({
      type: "instance.resumed",
      entityKind: "instance",
      entityId: "instance",
      topics: ["dashboard", "queue"],
    });
    expect(received).toEqual([event.sequence]);
    feed.close();
    db.close();
  });

  test("does not let a broken live subscriber fail the durable mutation", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const feed = new PlatformChangeFeed(db);
    feed.subscribe(() => {
      throw new Error("closed stream");
    });
    const received: number[] = [];
    feed.subscribe((event) => received.push(event.sequence));

    const event = feed.append({
      type: "instance.updated",
      entityKind: "instance",
      entityId: "instance",
      topics: ["dashboard"],
    });

    expect(received).toEqual([event.sequence]);
    expect(feed.list({ afterSequence: 0 })).toEqual([event]);
    feed.close();
    db.close();
  });
});
