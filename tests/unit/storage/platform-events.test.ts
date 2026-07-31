import { describe, expect, test } from "bun:test";

import { PlatformChangeEventSchema } from "@shared/events";
import { Database, createPlatformChangeEventRepository } from "@/storage";
import { SCHEMA_MIGRATIONS, SCHEMA_VERSION } from "@/storage/schema";

describe("storage/platform-change-events", () => {
  test("schema v7 creates the durable platform changelog", () => {
    const db = Database.open(":memory:");
    db.migrate();

    expect(SCHEMA_VERSION).toBe(14);
    expect(SCHEMA_MIGRATIONS.some((migration) => migration.version === 7)).toBe(true);
    expect(db.tableNames()).toContain("platform_change_events");
    db.close();
  });

  test("appends, replays, filters, and prunes ordered events", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const events = createPlatformChangeEventRepository(db);

    const run = events.append({
      projectId: "project-1",
      type: "run.state_changed",
      entityKind: "run",
      entityId: "run-1",
      topics: ["dashboard", "overview", "queue", "runs"],
      data: { state: "Running" },
      occurredAt: "2026-07-27T19:00:00.000Z",
    });
    const schedule = events.append({
      projectId: "project-2",
      type: "schedule.updated",
      entityKind: "schedule",
      entityId: "schedule-1",
      topics: ["dashboard", "schedules"],
      data: {},
      occurredAt: "2026-07-27T19:01:00.000Z",
    });
    const instance = events.append({
      projectId: null,
      type: "instance.paused",
      entityKind: "instance",
      entityId: "instance",
      topics: ["dashboard", "queue"],
      data: { paused: true },
      occurredAt: "2026-07-27T19:02:00.000Z",
    });

    expect(PlatformChangeEventSchema.parse(run)).toEqual(run);
    expect(schedule.sequence).toBe(run.sequence + 1);
    expect(instance.sequence).toBe(schedule.sequence + 1);
    expect(events.list({ afterSequence: run.sequence, limit: 10 })).toEqual([
      schedule,
      instance,
    ]);
    expect(
      events.list({
        afterSequence: 0,
        limit: 10,
        projectId: "project-1",
        topics: ["queue"],
      }),
    ).toEqual([run]);

    expect(events.pruneThrough(run.sequence)).toBe(1);
    expect(events.list({ afterSequence: 0, limit: 10 })).toEqual([schedule, instance]);
    expect(events.pruneToLatest(1)).toBe(1);
    expect(events.list({ afterSequence: 0, limit: 10 })).toEqual([instance]);
    db.close();
  });

  test("replays pre-rebrand task topics as agent events", () => {
    const db = Database.open(":memory:");
    db.migrate();
    db.connection()
      .query(
        `INSERT INTO platform_change_events (
          id, project_id, type, entity_kind, entity_id, topics_json,
          data_json, occurred_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "legacy-task-event",
        "project-1",
        "task.updated",
        "task",
        "task-1",
        JSON.stringify(["dashboard", "tasks"]),
        JSON.stringify({}),
        "2026-07-27T19:00:00.000Z",
        "2026-07-27T19:00:00.000Z",
      );

    const events = createPlatformChangeEventRepository(db).list();
    expect(events).toHaveLength(1);
    expect(events[0]?.topics).toEqual(["dashboard", "agents"]);
    db.close();
  });
});
