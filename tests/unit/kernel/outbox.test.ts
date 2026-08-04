import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PlatformChangeFeed } from "@/platform/events/platform-change-feed";
import { domainEvent, PlatformChangeOutbox, RecordingOutbox } from "@/kernel";
import { Database } from "@/infrastructure/persistence";

describe("kernel/outbox", () => {
  test("RecordingOutbox captures events", () => {
    const outbox = new RecordingOutbox();
    const event = domainEvent(
      {
        type: "catalog.project.synced",
        entityKind: "project",
        entityId: "p1",
        projectId: "p1",
        topics: ["projects", "dashboard"],
      },
      "2026-01-01T00:00:00.000Z",
    );
    outbox.publish([event]);
    expect(outbox.published).toHaveLength(1);
    expect(outbox.published[0]?.type).toBe("catalog.project.synced");
  });

  test("PlatformChangeOutbox appends to the durable feed", () => {
    const home = mkdtempSync(join(tmpdir(), "gojo-outbox-"));
    const db = Database.open(join(home, "gojo.db"));
    db.migrate();
    try {
      const feed = new PlatformChangeFeed(db);
      const outbox = new PlatformChangeOutbox(feed);
      outbox.publish([
        domainEvent(
          {
            type: "agent.updated",
            entityKind: "agent",
            entityId: "a1",
            projectId: "p1",
            topics: ["agents", "projects"],
            data: { enabled: true },
          },
          "2026-01-01T00:00:00.000Z",
        ),
      ]);
      const events = feed.list({ afterSequence: 0, projectId: "p1" });
      expect(events.some((e) => e.type === "agent.updated")).toBe(true);
    } finally {
      db.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
