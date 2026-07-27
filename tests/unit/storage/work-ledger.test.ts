import { describe, expect, test } from "bun:test";

import { Database, createRepositories } from "@/storage";
import { SCHEMA_MIGRATIONS, SCHEMA_VERSION } from "@/storage/schema";
import { createWorkRepositories } from "@/storage/work-repositories";

function seedProject(db: Database) {
  const repos = createRepositories(db);
  const project = repos.projects.create({
    name: "work-ledger",
    repoPath: "/tmp/work-ledger",
    remoteUrl: "https://gitlab.example.com/acme/work-ledger.git",
  });
  return { repos, project };
}

describe("storage/work-ledger", () => {
  test("latest schema includes the v6 source-agnostic ledger tables", () => {
    const db = Database.open(":memory:");
    db.migrate();

    expect(SCHEMA_VERSION).toBe(8);
    expect(SCHEMA_MIGRATIONS.some((migration) => migration.version === 6)).toBe(true);
    expect(SCHEMA_MIGRATIONS.some((migration) => migration.version === 8)).toBe(true);
    expect(db.tableNames()).toEqual(
      expect.arrayContaining([
        "source_connections",
        "project_sources",
        "source_sync_cursors",
        "work_items",
        "work_links",
        "work_events",
        "external_resources",
        "run_context",
      ]),
    );
    db.close();
  });

  test("migration backfills existing runs and integrations into linked work", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { repos, project } = seedProject(db);
    const task = repos.tasks.create({
      projectId: project.id,
      name: "ship-feature",
      prompt: "Ship the feature",
    });
    const run = repos.runs.create({
      projectId: project.id,
      taskId: task.id,
      idempotencyKey: "legacy-run",
      trigger: "manual",
    });
    repos.runIntegrations.upsertForRun({
      runId: run.id,
      mode: "pull-request",
      provider: "gitlab",
      repo: "acme/work-ledger",
      prNumber: 42,
      prUrl: "https://gitlab.example.com/acme/work-ledger/-/merge_requests/42",
      status: "open",
      openedAt: "2026-07-01T00:00:00.000Z",
      nextCheckAt: null,
    });

    const sqlite = db.connection();
    for (const table of [
      "run_context",
      "external_resources",
      "work_events",
      "work_links",
      "work_items",
      "source_sync_cursors",
      "project_sources",
      "source_connections",
    ]) {
      sqlite.exec(`DROP TABLE ${table};`);
    }
    sqlite.exec("DROP INDEX IF EXISTS idx_runs_work_item;");
    sqlite.exec("ALTER TABLE runs DROP COLUMN work_item_id;");
    sqlite.query("DELETE FROM schema_migrations").run();
    sqlite
      .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(5, new Date().toISOString());

    db.migrate();

    const work = createWorkRepositories(db);
    const items = work.items.listByProject(project.id, { limit: 20, offset: 0 });
    const runItem = items.items.find((item) => item.kind === "run");
    const mergeRequest = items.items.find((item) => item.kind === "pull-request");
    expect(runItem?.title).toBe("ship-feature");
    expect(mergeRequest?.nativeKey).toBe("42");
    expect(mergeRequest?.attention).toBe("stale");
    expect(work.links.listByWorkItem(runItem?.id ?? "")).toContainEqual(
      expect.objectContaining({ targetWorkItemId: mergeRequest?.id, type: "delivers" }),
    );
    db.close();
  });

  test("keeps source-native state while verified counts exclude stale work", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project } = seedProject(db);
    const work = createWorkRepositories(db);
    const connection = work.connections.create({
      name: "Company GitLab",
      adapter: "gitlab",
      baseUrl: "https://gitlab.example.com",
      capabilities: {
        read: true,
        list: true,
        webhooks: true,
        write: false,
        workKinds: ["pull-request", "issue"],
      },
    });
    const source = work.sources.create({
      projectId: project.id,
      connectionId: connection.id,
      kind: "repository",
      externalKey: "acme/work-ledger",
      displayName: "acme/work-ledger",
    });

    work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "issue",
      nativeKey: "ENG-12",
      title: "Investigate latency",
      delivery: "open",
      provenance: "human",
      nativeState: "in_progress",
      nativeJson: JSON.stringify({ priority: "urgent", custom_state: "triage" }),
      observedAt: "2026-07-27T16:00:00.000Z",
      syncState: "current",
    });
    work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "pull-request",
      nativeKey: "43",
      title: "Old merge request",
      delivery: "open",
      provenance: "external",
      nativeState: "opened",
      observedAt: "2026-07-20T16:00:00.000Z",
      syncState: "stale",
    });

    const page = work.items.listByProject(project.id, { limit: 20, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.items.find((item) => item.nativeKey === "ENG-12")?.nativeState).toBe(
      "in_progress",
    );
    expect(
      JSON.parse(page.items.find((item) => item.nativeKey === "ENG-12")?.nativeJson ?? "{}"),
    ).toMatchObject({ custom_state: "triage" });
    expect(work.items.status(project.id)).toMatchObject({
      verifiedOpen: 1,
      staleOpen: 1,
      needsAttention: 1,
    });
    db.close();
  });

  test("operator resolution clears attention counts without inventing terminal delivery", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project } = seedProject(db);
    const work = createWorkRepositories(db);
    const connection = work.connections.create({
      name: "Company GitLab",
      adapter: "gitlab",
      baseUrl: "https://gitlab.example.com",
      capabilities: {
        read: true,
        list: true,
        webhooks: true,
        write: false,
        workKinds: ["issue"],
      },
    });
    const source = work.sources.create({
      projectId: project.id,
      connectionId: connection.id,
      kind: "repository",
      externalKey: "acme/work-ledger",
      displayName: "acme/work-ledger",
    });
    const stale = work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "issue",
      nativeKey: "ENG-99",
      title: "Ghost issue",
      delivery: "open",
      attention: "stale",
      provenance: "external",
      nativeState: "opened",
      syncState: "stale",
      lastError: "No longer present in the source active-work snapshot",
    });

    const resolved = work.items.resolve(stale.id, {
      resolvedBy: "operator",
      note: "Confirmed closed upstream",
    });
    expect(resolved).toMatchObject({
      attention: "none",
      delivery: "open",
      resolution: "operator",
      resolvedBy: "operator",
      resolutionNote: "Confirmed closed upstream",
      lastError: null,
    });
    expect(work.items.status(project.id)).toMatchObject({
      needsAttention: 0,
      staleOpen: 0,
      verifiedOpen: 0,
    });

    const reopened = work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "issue",
      nativeKey: "ENG-99",
      title: "Ghost issue returned",
      delivery: "open",
      provenance: "external",
      nativeState: "opened",
      syncState: "current",
      lastError: null,
    });
    expect(reopened).toMatchObject({
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
      syncState: "current",
      attention: "none",
    });
    expect(work.items.status(project.id)).toMatchObject({
      verifiedOpen: 1,
      needsAttention: 0,
    });
    db.close();
  });
});
