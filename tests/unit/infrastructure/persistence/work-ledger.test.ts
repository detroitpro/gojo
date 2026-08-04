import { describe, expect, test } from "bun:test";

import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from "@/infrastructure/persistence";
import { SCHEMA_MIGRATIONS, SCHEMA_VERSION } from "@/infrastructure/persistence/schema";
import { createWorkRepositories } from "@/contexts/work/infrastructure/work-repositories";

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

    expect(SCHEMA_VERSION).toBe(14);
    expect(SCHEMA_MIGRATIONS.some((migration) => migration.version === 6)).toBe(true);
    expect(SCHEMA_MIGRATIONS.some((migration) => migration.version === 8)).toBe(true);
    expect(SCHEMA_MIGRATIONS.some((migration) => migration.version === 10)).toBe(true);
    expect(SCHEMA_MIGRATIONS.some((migration) => migration.version === 11)).toBe(true);
    expect(db.tableNames()).toEqual(
      expect.arrayContaining([
        "source_connections",
        "project_sources",
        "source_sync_cursors",
        "work_items",
        "work_links",
        "work_events",
        "work_status_rollup",
        "external_resources",
        "run_context",
      ]),
    );
    db.close();
  });

  test("backfill does not create run: orphans when a ULID work item already owns the run", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { repos, project } = seedProject(db);
    const work = createWorkRepositories(db);
    const agent = repos.agents.create({
      projectId: project.id,
      name: "self-heal",
      prompt: "Heal",
    });
    const startedAt = "2026-08-03T10:30:00.000Z";
    const run = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "owned-run",
      trigger: "schedule",
      state: "Running",
    });
    repos.runs.update(run.id, { startedAt, state: "Running" });
    const canonical = work.items.create({
      projectId: project.id,
      kind: "run",
      nativeKey: run.id,
      title: "self-heal",
      execution: "running",
      outcome: "pending",
      provenance: "gojo-agent",
      startedAt,
    });
    repos.runs.update(run.id, { workItemId: canonical.id });

    // Simulate a mid-flight CLI/daemon reopen that used to insert a stuck twin.
    db.migrate();

    const twins = db
      .connection()
      .query<{ id: string; execution: string }, [string]>(
        "SELECT id, execution FROM work_items WHERE kind = 'run' AND native_key = ?",
      )
      .all(run.id);
    expect(twins).toEqual([{ id: canonical.id, execution: "running" }]);
    expect(repos.runs.findById(run.id)?.workItemId).toBe(canonical.id);
    db.close();
  });

  test("backfill removes superseded run: orphans and remaps delivers links", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { repos, project } = seedProject(db);
    const work = createWorkRepositories(db);
    const agent = repos.agents.create({
      projectId: project.id,
      name: "deps-rust",
      prompt: "Bump",
    });
    const startedAt = "2026-07-31T07:02:00.000Z";
    const finishedAt = "2026-07-31T07:03:00.000Z";
    const run = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "orphan-run",
      trigger: "schedule",
      state: "Succeeded",
    });
    repos.runs.update(run.id, {
      state: "Succeeded",
      startedAt,
      finishedAt,
    });
    const canonical = work.items.create({
      projectId: project.id,
      kind: "run",
      nativeKey: run.id,
      title: "deps-rust",
      execution: "terminal",
      outcome: "succeeded",
      provenance: "gojo-agent",
      startedAt,
      completedAt: finishedAt,
    });
    repos.runs.update(run.id, { workItemId: canonical.id });

    const orphanId = `run:${run.id}`;
    db.connection()
      .query(
        `INSERT INTO work_items (
          id, project_id, source_id, kind, native_key, title, summary,
          execution, delivery, outcome, attention, provenance, actor_name,
          profile_id, labels_json, native_state, native_json, web_url,
          observed_at, next_sync_at, sync_state, last_error, created_at,
          updated_at, started_at, completed_at
        ) VALUES (?, ?, NULL, 'run', ?, 'deps-rust', '', 'queued', 'none',
          'pending', 'none', 'gojo-agent', NULL, NULL, '[]', 'Queued', '{}', NULL,
          ?, NULL, 'current', NULL, ?, ?, NULL, NULL)`,
      )
      .run(orphanId, project.id, run.id, startedAt, run.createdAt, startedAt);
    const pr = work.items.create({
      projectId: project.id,
      kind: "pull-request",
      nativeKey: "9",
      title: "Bump deps",
      delivery: "merged",
      outcome: "succeeded",
      provenance: "gojo-agent",
    });
    work.links.create(orphanId, pr.id, "delivers");

    expect(work.items.status(project.id).queued).toBe(1);

    db.migrate();

    expect(
      db
        .connection()
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM work_items WHERE id = ?",
        )
        .get(orphanId)?.n,
    ).toBe(0);
    expect(work.links.listByWorkItem(canonical.id)).toContainEqual(
      expect.objectContaining({ targetWorkItemId: pr.id, type: "delivers" }),
    );
    expect(work.items.status(project.id)).toMatchObject({
      working: 0,
      queued: 0,
    });
    db.close();
  });

  test("backfill syncs canonical run: work items when the run is already terminal", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { repos, project } = seedProject(db);
    const agent = repos.agents.create({
      projectId: project.id,
      name: "activity-digest",
      prompt: "Digest",
    });
    const startedAt = "2026-08-01T12:00:00.000Z";
    const finishedAt = "2026-08-01T12:01:00.000Z";
    const run = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "stuck-canonical",
      trigger: "schedule",
      state: "Succeeded",
    });
    repos.runs.update(run.id, {
      state: "Succeeded",
      startedAt,
      finishedAt,
    });
    const orphanId = `run:${run.id}`;
    db.connection()
      .query(
        `INSERT INTO work_items (
          id, project_id, source_id, kind, native_key, title, summary,
          execution, delivery, outcome, attention, provenance, actor_name,
          profile_id, labels_json, native_state, native_json, web_url,
          observed_at, next_sync_at, sync_state, last_error, created_at,
          updated_at, started_at, completed_at
        ) VALUES (?, ?, NULL, 'run', ?, 'activity-digest', '', 'running', 'none',
          'pending', 'none', 'gojo-agent', NULL, NULL, '[]', 'Running', '{}', NULL,
          ?, NULL, 'current', NULL, ?, ?, ?, NULL)`,
      )
      .run(
        orphanId,
        project.id,
        run.id,
        startedAt,
        run.createdAt,
        startedAt,
        startedAt,
      );
    repos.runs.update(run.id, { workItemId: orphanId });

    const work = createWorkRepositories(db);
    expect(work.items.status(project.id).working).toBe(1);

    db.migrate();

    const synced = work.items.findById(orphanId);
    expect(synced).toMatchObject({
      execution: "terminal",
      outcome: "succeeded",
      completedAt: finishedAt,
    });
    expect(work.items.status(project.id).working).toBe(0);
    db.close();
  });

  test("migration backfills existing runs and integrations into linked work", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { repos, project } = seedProject(db);
    const agent = repos.agents.create({
      projectId: project.id,
      name: "ship-feature",
      prompt: "Ship the feature",
    });
    const run = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
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
      "source_comment_cursors",
      "control_intents",
      "approvals",
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
    // Reverse the v11 rename so v6+ migrations replay cleanly on this v5 snapshot.
    sqlite.exec("ALTER TABLE agents RENAME TO tasks;");
    sqlite.exec("ALTER TABLE profiles RENAME TO agent_profiles;");
    sqlite.exec("ALTER TABLE tasks RENAME COLUMN profile_id TO agent_profile_id;");
    sqlite.exec("ALTER TABLE schedules RENAME COLUMN agent_id TO task_id;");
    sqlite.exec("ALTER TABLE runs RENAME COLUMN agent_id TO task_id;");
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

  test("history filter orders by completion and enriches task/agent attribution", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { repos, project } = seedProject(db);
    const work = createWorkRepositories(db);
    const profile = repos.profiles.create({
      projectId: project.id,
      name: "cursor-local",
      adapter: "cursor",
    });
    const agent = repos.agents.create({
      projectId: project.id,
      name: "activity-digest",
      prompt: "digest",
      profileId: profile.id,
    });
    const run = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "history-run-1",
      trigger: "manual",
    });
    const runWork = work.items.create({
      projectId: project.id,
      kind: "run",
      nativeKey: run.id,
      title: "Done",
      summary: "Finished digest",
      execution: "terminal",
      outcome: "succeeded",
      provenance: "gojo-agent",
      profileId: profile.id,
      actorName: "cursor-local",
      completedAt: "2026-07-28T12:00:00.000Z",
    });
    work.runContexts.create({
      runId: run.id,
      workItemId: runWork.id,
      agentName: "activity-digest",
      agentDescription: "Digest activity",
      prompt: "digest",
      manifestHash: null,
      instructions: "{}",
      profileJson: "{}",
      adapter: "cursor",
      model: null,
      validationJson: "{}",
      integrationJson: "{}",
      failurePolicyJson: "{}",
      environmentJson: "{}",
      subjectJson: null,
      resumeBranch: null,
      baseBranch: "main",
      scheduleJson: null,
    });
    const active = work.items.create({
      projectId: project.id,
      kind: "run",
      nativeKey: "run-active",
      title: "maintain-merge",
      execution: "running",
      outcome: "pending",
      provenance: "gojo-agent",
    });
    const pr = work.items.create({
      projectId: project.id,
      kind: "pull-request",
      nativeKey: "12",
      title: "Fix scheduler storage",
      delivery: "merged",
      outcome: "succeeded",
      provenance: "gojo-agent",
      completedAt: "2026-07-28T13:00:00.000Z",
    });
    work.links.create(runWork.id, pr.id, "delivers");

    const history = work.items.listByProject(project.id, {
      limit: 25,
      offset: 0,
      history: true,
    });
    expect(history.total).toBe(2);
    expect(history.items.map((item) => item.id)).toEqual([pr.id, runWork.id]);
    expect(history.items[0]).toMatchObject({
      id: pr.id,
      agentName: "activity-digest",
      agentLabel: "gojo-agent",
    });
    expect(history.items[1]).toMatchObject({
      id: runWork.id,
      agentName: "activity-digest",
      agentLabel: "cursor-local",
      deliveredWork: [expect.objectContaining({ id: pr.id, title: "Fix scheduler storage" })],
    });

    const all = work.items.listByProject(project.id, { limit: 25, offset: 0 });
    expect(all.total).toBe(3);
    expect(all.items.some((item) => item.id === active.id)).toBe(true);
    db.close();
  });

  test("source upsert does not downgrade gojo-agent provenance", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project } = seedProject(db);
    const work = createWorkRepositories(db);
    const connection = work.connections.create({
      name: "GitHub",
      adapter: "github",
      baseUrl: "https://api.github.com",
      capabilities: {
        read: true,
        list: true,
        webhooks: true,
        write: false,
        workKinds: ["pull-request"],
      },
    });
    const source = work.sources.create({
      projectId: project.id,
      connectionId: connection.id,
      kind: "repository",
      externalKey: "acme/agent-prs",
      displayName: "acme/agent-prs",
    });
    work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "pull-request",
      nativeKey: "7",
      title: "Agent PR",
      delivery: "open",
      provenance: "gojo-agent",
      actorName: "gojo",
      syncState: "current",
    });

    const downgraded = work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "pull-request",
      nativeKey: "7",
      title: "Agent PR",
      delivery: "open",
      provenance: "human",
      actorName: "detroitpro",
      syncState: "current",
    });
    expect(downgraded.provenance).toBe("gojo-agent");
    expect(downgraded.actorName).toBe("detroitpro");
    db.close();
  });
});
