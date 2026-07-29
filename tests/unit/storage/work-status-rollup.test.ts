import { describe, expect, test } from "bun:test";

import { Database, createRepositories } from "@/storage";
import { countWorkStateAt, hourBucketAt, previousClosedHour } from "@/storage/work-status-counts";
import { createWorkStatusRollup } from "@/storage/work-status-rollup";
import { createWorkRepositories } from "@/storage/work-repositories";

function stampStateEvents(db: Database, projectId: string, at: string): void {
  db.connection()
    .query(
      `UPDATE work_events SET occurred_at = ?
       WHERE project_id = ? AND execution IS NOT NULL`,
    )
    .run(at, projectId);
}

describe("storage/work-status-rollup", () => {
  test("countsAt materializes on miss and reuses the cached bucket", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "rollup", repoPath: "/tmp/rollup" });
    const work = createWorkRepositories(db);
    const rollup = createWorkStatusRollup(db);

    work.items.create({
      projectId: project.id,
      kind: "run",
      title: "run",
      execution: "running",
    });

    const bucket = previousClosedHour(new Date().toISOString());
    stampStateEvents(db, project.id, bucket);

    const first = rollup.countsAt(project.id, bucket);
    expect(first.working).toBe(1);

    const rows = db
      .connection()
      .query("SELECT * FROM work_status_rollup WHERE project_id = ? AND bucket_at = ?")
      .all(project.id, hourBucketAt(bucket));
    expect(rows.length).toBeGreaterThan(0);

    // Mutate live state after materialization — cached bucket must stay pinned.
    const item = work.items.listByProject(project.id, { limit: 10, offset: 0 }).items[0]!;
    work.items.update(item.id, { execution: "terminal", outcome: "succeeded" });

    const second = rollup.countsAt(project.id, bucket);
    expect(second).toEqual(first);
    expect(second.working).toBe(1);
    db.close();
  });

  test("rebuild deletes rows and rematerialization matches replay", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "rebuild", repoPath: "/tmp/rebuild" });
    const work = createWorkRepositories(db);
    const rollup = createWorkStatusRollup(db);

    work.items.create({
      projectId: project.id,
      kind: "pull-request",
      title: "pr",
      delivery: "open",
      syncState: "current",
    });

    const bucket = previousClosedHour(new Date().toISOString());
    stampStateEvents(db, project.id, bucket);

    const before = rollup.countsAt(project.id, bucket);
    expect(before.verifiedOpen).toBe(1);

    const deleted = rollup.rebuild({ projectId: project.id });
    expect(deleted).toBeGreaterThan(0);

    const after = rollup.countsAt(project.id, bucket);
    const replayed = countWorkStateAt(db, { projectId: project.id, at: hourBucketAt(bucket) });
    expect(after).toEqual(replayed);
    expect(after.verifiedOpen).toBe(1);
    db.close();
  });

  test("materializeClosedHour pins the previous hour", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "closed", repoPath: "/tmp/closed" });
    const work = createWorkRepositories(db);
    const rollup = createWorkStatusRollup(db);

    work.items.create({
      projectId: project.id,
      kind: "run",
      title: "run",
      execution: "queued",
    });

    const now = new Date().toISOString();
    const closed = previousClosedHour(now);
    stampStateEvents(db, project.id, closed);

    rollup.materializeClosedHour(project.id, now);
    const rows = db
      .connection()
      .query(
        `SELECT bucket_at FROM work_status_rollup
         WHERE project_id = ? ORDER BY bucket_at`,
      )
      .all(project.id) as Array<{ bucket_at: string }>;
    expect(rows.some((row) => row.bucket_at === closed)).toBe(true);
    db.close();
  });
});
