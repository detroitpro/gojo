import { describe, expect, test } from "bun:test";

import { Database, createRepositories } from "@/storage";
import { countWorkStateAt } from "@/storage/work-status-counts";
import { createWorkRepositories } from "@/storage/work-repositories";

function seed(db: Database) {
  const repos = createRepositories(db);
  const project = repos.projects.create({
    name: "replay",
    repoPath: "/tmp/replay",
  });
  const work = createWorkRepositories(db);
  return { repos, project, work };
}

describe("storage/work-state-replay", () => {
  test("countWorkStateAt at now matches items.status", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project, work } = seed(db);

    work.items.create({
      projectId: project.id,
      kind: "run",
      title: "active",
      execution: "running",
      delivery: "none",
      outcome: "pending",
    });
    work.items.create({
      projectId: project.id,
      kind: "pull-request",
      title: "open pr",
      execution: "none",
      delivery: "open",
      outcome: "pending",
      syncState: "current",
    });
    work.items.create({
      projectId: project.id,
      kind: "pull-request",
      title: "stale pr",
      execution: "none",
      delivery: "open",
      outcome: "pending",
      syncState: "stale",
      attention: "stale",
    });

    const live = work.items.status(project.id);
    const replayed = countWorkStateAt(db, {
      projectId: project.id,
      at: new Date().toISOString(),
    });

    expect(replayed).toEqual({
      working: live.working,
      queued: live.queued,
      needsAttention: live.needsAttention,
      verifiedOpen: live.verifiedOpen,
      staleOpen: live.staleOpen,
    });
    db.close();
  });

  test("countWorkStateAt returns older counts before a later transition", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project, work } = seed(db);

    const item = work.items.create({
      projectId: project.id,
      kind: "run",
      title: "run",
      execution: "queued",
    });

    const t1 = "2026-07-01T10:00:00.000Z";
    const t2 = "2026-07-01T12:00:00.000Z";

    // Stamp the seed event to t1, then append a later running transition.
    db.connection()
      .query("UPDATE work_events SET occurred_at = ? WHERE work_item_id = ? AND execution IS NOT NULL")
      .run(t1, item.id);

    work.items.update(item.id, { execution: "running" });
    db.connection()
      .query(
        `UPDATE work_events SET occurred_at = ?
         WHERE work_item_id = ? AND execution = 'running'`,
      )
      .run(t2, item.id);

    expect(
      countWorkStateAt(db, { projectId: project.id, at: "2026-07-01T10:30:00.000Z" }),
    ).toMatchObject({ working: 0, queued: 1 });
    expect(
      countWorkStateAt(db, { projectId: project.id, at: "2026-07-01T12:30:00.000Z" }),
    ).toMatchObject({ working: 1, queued: 0 });
    db.close();
  });

  test("kind filter isolates run gauges", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project, work } = seed(db);

    work.items.create({
      projectId: project.id,
      kind: "run",
      title: "run",
      execution: "running",
    });
    work.items.create({
      projectId: project.id,
      kind: "pull-request",
      title: "pr",
      execution: "none",
      delivery: "open",
      syncState: "current",
    });

    expect(
      countWorkStateAt(db, {
        projectId: project.id,
        kind: "run",
        at: new Date().toISOString(),
      }),
    ).toMatchObject({ working: 1, verifiedOpen: 0 });
    db.close();
  });

  test("no-op update does not append another state event", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project, work } = seed(db);
    const item = work.items.create({
      projectId: project.id,
      kind: "run",
      title: "run",
      execution: "queued",
    });
    const before = work.events.listByWorkItem(item.id).filter((e) => e.type === "work.state_changed");
    work.items.update(item.id, { execution: "queued", title: "renamed" });
    const after = work.events.listByWorkItem(item.id).filter((e) => e.type === "work.state_changed");
    expect(after.length).toBe(before.length);
    db.close();
  });
});
