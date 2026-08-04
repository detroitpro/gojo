import { describe, expect, test } from "bun:test";

import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from "@/infrastructure/persistence";
import { countWorkStateAt, hourBucketAt, previousClosedHour } from "@/contexts/work/infrastructure/work-status-counts";
import { createWorkStatusRollup } from "@/contexts/work/infrastructure/work-status-rollup";
import { createWorkRepositories } from "@/contexts/work/infrastructure/work-repositories";

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

  test("countsAtKind aggregates the same kind across projects", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const projectA = repos.projects.create({ name: "a", repoPath: "/tmp/a" });
    const projectB = repos.projects.create({ name: "b", repoPath: "/tmp/b" });
    const work = createWorkRepositories(db);
    const rollup = createWorkStatusRollup(db);

    work.items.create({
      projectId: projectA.id,
      kind: "run",
      title: "run-a",
      execution: "running",
    });
    work.items.create({
      projectId: projectB.id,
      kind: "run",
      title: "run-b",
      execution: "queued",
    });

    const bucket = previousClosedHour(new Date().toISOString());
    stampStateEvents(db, projectA.id, bucket);
    stampStateEvents(db, projectB.id, bucket);

    const counts = rollup.countsAtKind("run", bucket);
    expect(counts.working).toBe(1);
    expect(counts.queued).toBe(1);
    db.close();
  });

  test("rebuild with from deletes buckets at or after the cutoff", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const olderProject = repos.projects.create({ name: "older", repoPath: "/tmp/older" });
    const newerProject = repos.projects.create({ name: "newer", repoPath: "/tmp/newer" });
    const work = createWorkRepositories(db);
    const rollup = createWorkStatusRollup(db);

    work.items.create({
      projectId: olderProject.id,
      kind: "run",
      title: "older-run",
      execution: "running",
    });
    work.items.create({
      projectId: newerProject.id,
      kind: "run",
      title: "newer-run",
      execution: "queued",
    });

    const olderBucket = "2026-01-01T10:00:00.000Z";
    const newerBucket = "2026-01-01T12:00:00.000Z";
    stampStateEvents(db, olderProject.id, olderBucket);
    stampStateEvents(db, newerProject.id, newerBucket);

    rollup.countsAt(olderProject.id, olderBucket);
    rollup.countsAt(newerProject.id, newerBucket);

    const deleted = rollup.rebuild({ from: newerBucket });
    expect(deleted).toBeGreaterThan(0);

    const remaining = db
      .connection()
      .query("SELECT bucket_at FROM work_status_rollup")
      .all() as Array<{ bucket_at: string }>;
    expect(remaining.every((row) => row.bucket_at < newerBucket)).toBe(true);
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

  test("countsAtKind aggregates state across projects for a kind", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const projectA = repos.projects.create({ name: "rollup-a", repoPath: "/tmp/rollup-a" });
    const projectB = repos.projects.create({ name: "rollup-b", repoPath: "/tmp/rollup-b" });
    const work = createWorkRepositories(db);
    const rollup = createWorkStatusRollup(db);

    work.items.create({
      projectId: projectA.id,
      kind: "run",
      title: "running",
      execution: "running",
    });
    work.items.create({
      projectId: projectB.id,
      kind: "run",
      title: "queued",
      execution: "queued",
    });
    work.items.create({
      projectId: projectA.id,
      kind: "issue",
      title: "open issue",
      delivery: "open",
      syncState: "current",
    });

    const bucket = previousClosedHour(new Date().toISOString());
    stampStateEvents(db, projectA.id, bucket);
    stampStateEvents(db, projectB.id, bucket);

    const runCounts = rollup.countsAtKind("run", bucket);
    expect(runCounts.working).toBe(1);
    expect(runCounts.queued).toBe(1);
    db.close();
  });

  test("rebuild deletes by from timestamp and project filter combinations", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "rebuild-filters", repoPath: "/tmp/rebuild-filters" });
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
    rollup.countsAt(project.id, bucket);

    const rowCount = () =>
      (db.connection().query("SELECT COUNT(*) AS n FROM work_status_rollup").get() as { n: number }).n;

    expect(rowCount()).toBeGreaterThan(0);
    expect(rollup.rebuild({ from: bucket })).toBeGreaterThan(0);
    expect(rowCount()).toBe(0);

    rollup.countsAt(project.id, bucket);
    expect(rollup.rebuild({ projectId: project.id, from: bucket })).toBeGreaterThan(0);
    expect(rowCount()).toBe(0);
    db.close();
  });
});
