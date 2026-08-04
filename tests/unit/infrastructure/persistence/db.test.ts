import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRepositories } from "@/platform/create-repositories";
import {
  Database,
  SCHEMA_VERSION
} from "@/infrastructure/persistence";

describe("storage/db", () => {
  let db: Database | null = null;
  let tempDir: string | null = null;

  afterEach(() => {
    db?.close();
    db = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function openInMemory(): Database {
    db = Database.open(":memory:");
    db.migrate();
    return db;
  }

  function openTempFile(): Database {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-storage-test-"));
    const dbPath = join(tempDir, "gojo.db");
    db = Database.open(dbPath);
    db.migrate();
    return db;
  }

  test("opens in-memory database", () => {
    const database = openInMemory();
    expect(database.connection()).toBeDefined();
  });

  test("opens temp file database under os.tmpdir()", () => {
    const database = openTempFile();
    expect(tempDir).toStartWith(tmpdir());
    expect(database.connection()).toBeDefined();
  });

  test("migrations apply all expected tables", () => {
    const database = openInMemory();
    expect(database.hasExpectedTables()).toBe(true);
  });

  test("migration v5 adds admission columns on existing v4 databases", () => {
    const database = openInMemory();
    const sqlite = database.connection();

    // Downgrade to a v4-shaped runs table (no admission columns / queue index).
    sqlite.exec("DROP INDEX IF EXISTS idx_runs_queue;");
    sqlite.exec("ALTER TABLE runs DROP COLUMN not_before_at;");
    sqlite.exec("ALTER TABLE runs DROP COLUMN expires_at;");
    sqlite.exec("ALTER TABLE runs DROP COLUMN admitted_at;");
    sqlite.exec("ALTER TABLE runs DROP COLUMN priority;");
    // Reverse the v11 rename so v9 (ALTER TABLE tasks…) and v11 replay cleanly.
    sqlite.exec("ALTER TABLE agents RENAME TO tasks;");
    sqlite.exec("ALTER TABLE profiles RENAME TO agent_profiles;");
    sqlite.exec("ALTER TABLE tasks RENAME COLUMN profile_id TO agent_profile_id;");
    sqlite.exec("ALTER TABLE schedules RENAME COLUMN agent_id TO task_id;");
    sqlite.exec("ALTER TABLE runs RENAME COLUMN agent_id TO task_id;");
    sqlite.exec("ALTER TABLE work_items RENAME COLUMN profile_id TO agent_profile_id;");
    sqlite.exec("ALTER TABLE run_context RENAME COLUMN agent_name TO task_name;");
    sqlite.exec("ALTER TABLE run_context RENAME COLUMN agent_description TO task_description;");
    sqlite.exec("ALTER TABLE run_context RENAME COLUMN profile_json TO agent_profile_json;");
    // Fresh DBs only record latest SCHEMA_VERSION; pin to 4 so v5+ run.
    sqlite.query("DELETE FROM schema_migrations").run();
    sqlite
      .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(4, new Date().toISOString());

    database.migrate();

    const version = sqlite
      .query<{ version: number }, []>(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
      )
      .get()?.version;
    expect(version).toBe(SCHEMA_VERSION);

    const columns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('runs')")
      .all()
      .map((row) => row.name);
    expect(columns).toContain("not_before_at");
    expect(columns).toContain("expires_at");
    expect(columns).toContain("admitted_at");
    expect(columns).toContain("priority");
  });

  test("migration v9 adds agent notification routing on existing v8 databases", () => {
    const database = openInMemory();
    const sqlite = database.connection();

    // v9's ALTER TABLE targets the pre-v11 `tasks` name and v11 later renames
    // it to `agents`, so simulate a v8 DB by fully reversing v11 (tables,
    // FK columns, run_context ownership fields) and then dropping the
    // notifications column that v9 will re-add.
    sqlite.exec("ALTER TABLE agents RENAME TO tasks;");
    sqlite.exec("ALTER TABLE profiles RENAME TO agent_profiles;");
    sqlite.exec("ALTER TABLE tasks RENAME COLUMN profile_id TO agent_profile_id;");
    sqlite.exec("ALTER TABLE schedules RENAME COLUMN agent_id TO task_id;");
    sqlite.exec("ALTER TABLE runs RENAME COLUMN agent_id TO task_id;");
    sqlite.exec("ALTER TABLE work_items RENAME COLUMN profile_id TO agent_profile_id;");
    sqlite.exec("ALTER TABLE run_context RENAME COLUMN agent_name TO task_name;");
    sqlite.exec("ALTER TABLE run_context RENAME COLUMN agent_description TO task_description;");
    sqlite.exec("ALTER TABLE run_context RENAME COLUMN profile_json TO agent_profile_json;");
    sqlite.exec("ALTER TABLE tasks DROP COLUMN notifications_json;");
    sqlite.query("DELETE FROM schema_migrations").run();
    sqlite
      .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(8, new Date().toISOString());

    database.migrate();

    const columns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('agents')")
      .all()
      .map((row) => row.name);
    expect(columns).toContain("notifications_json");

    const repos = createRepositories(database);
    const project = repos.projects.create({ name: "routing", repoPath: "/tmp/routing" });
    const agent = repos.agents.create({
      projectId: project.id,
      name: "activity-digest",
      prompt: "report",
      notificationsJson: JSON.stringify({ onSuccess: ["ghost"] }),
    });
    expect(repos.agents.findById(agent.id)?.notificationsJson).toBe('{"onSuccess":["ghost"]}');
  });

  test("migration v13 adds environment_json on agents and run_context", () => {
    const database = openInMemory();
    const sqlite = database.connection();

    sqlite.exec("ALTER TABLE agents DROP COLUMN environment_json;");
    sqlite.exec("ALTER TABLE run_context DROP COLUMN environment_json;");
    sqlite.query("DELETE FROM schema_migrations").run();
    sqlite
      .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(12, new Date().toISOString());

    database.migrate();

    const agentColumns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('agents')")
      .all()
      .map((row) => row.name);
    expect(agentColumns).toContain("environment_json");

    const runContextColumns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('run_context')")
      .all()
      .map((row) => row.name);
    expect(runContextColumns).toContain("environment_json");

    const repos = createRepositories(database);
    const project = repos.projects.create({ name: "env-demo", repoPath: "/tmp/env-demo" });
    const agent = repos.agents.create({
      projectId: project.id,
      name: "karakeep-catalog",
      prompt: "pipeline",
      environmentJson: JSON.stringify({
        file: ".env",
        include: ["KARAKEEP_API_KEY"],
        required: ["KARAKEEP_API_KEY"],
      }),
    });
    expect(JSON.parse(repos.agents.findById(agent.id)?.environmentJson ?? "{}")).toEqual({
      file: ".env",
      include: ["KARAKEEP_API_KEY"],
      required: ["KARAKEEP_API_KEY"],
    });
  });

  test("migration v14 adds trigger subjects, approvals, intents, and comment cursors", () => {
    const database = openInMemory();
    const sqlite = database.connection();

    sqlite.exec("ALTER TABLE agents DROP COLUMN trigger_json;");
    sqlite.exec("ALTER TABLE run_context DROP COLUMN subject_json;");
    sqlite.exec("ALTER TABLE run_context DROP COLUMN resume_branch;");
    sqlite.exec("DROP TABLE source_comment_cursors;");
    sqlite.exec("DROP TABLE control_intents;");
    sqlite.exec("DROP TABLE approvals;");
    sqlite.query("DELETE FROM schema_migrations").run();
    sqlite
      .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(13, new Date().toISOString());

    database.migrate();

    const agentColumns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('agents')")
      .all()
      .map((row) => row.name);
    expect(agentColumns).toContain("trigger_json");

    const runContextColumns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('run_context')")
      .all()
      .map((row) => row.name);
    expect(runContextColumns).toContain("subject_json");
    expect(runContextColumns).toContain("resume_branch");

    const tables = new Set(database.tableNames());
    expect(tables.has("approvals")).toBe(true);
    expect(tables.has("control_intents")).toBe(true);
    expect(tables.has("source_comment_cursors")).toBe(true);

    const repos = createRepositories(database);
    const project = repos.projects.create({ name: "trigger-demo", repoPath: "/tmp/trigger" });
    const agent = repos.agents.create({
      projectId: project.id,
      name: "implement-issue",
      prompt: "implement",
      triggerJson: JSON.stringify({
        on: "issue-label",
        requireLabels: ["gojo:ready"],
        trustedActors: ["detroitpro"],
        maxOpenClaims: 1,
      }),
    });
    expect(JSON.parse(repos.agents.findById(agent.id)?.triggerJson ?? "{}").on).toBe(
      "issue-label",
    );
  });

  test("migration v11 renames tasks/agent_profiles into agents/profiles", () => {
    const database = openInMemory();
    const sqlite = database.connection();

    // Simulate a v10 database by reversing v11's renames end-to-end (tables,
    // FK columns, and run_context ownership fields). The v11 migration should
    // put us right back at the current schema.
    sqlite.exec("ALTER TABLE agents RENAME TO tasks;");
    sqlite.exec("ALTER TABLE profiles RENAME TO agent_profiles;");
    sqlite.exec("ALTER TABLE tasks RENAME COLUMN profile_id TO agent_profile_id;");
    sqlite.exec("ALTER TABLE schedules RENAME COLUMN agent_id TO task_id;");
    sqlite.exec("ALTER TABLE runs RENAME COLUMN agent_id TO task_id;");
    sqlite.exec("ALTER TABLE work_items RENAME COLUMN profile_id TO agent_profile_id;");
    sqlite.exec("ALTER TABLE run_context RENAME COLUMN agent_name TO task_name;");
    sqlite.exec("ALTER TABLE run_context RENAME COLUMN agent_description TO task_description;");
    sqlite.exec("ALTER TABLE run_context RENAME COLUMN profile_json TO agent_profile_json;");
    sqlite.query("DELETE FROM schema_migrations").run();
    sqlite
      .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(10, new Date().toISOString());

    database.migrate();

    expect(database.hasExpectedTables()).toBe(true);
    const tableNames = new Set(database.tableNames());
    expect(tableNames.has("agents")).toBe(true);
    expect(tableNames.has("profiles")).toBe(true);
    expect(tableNames.has("tasks")).toBe(false);
    expect(tableNames.has("agent_profiles")).toBe(false);

    const version = sqlite
      .query<{ version: number }, []>(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
      )
      .get()?.version;
    expect(version).toBe(SCHEMA_VERSION);

    const agentColumns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('agents')")
      .all()
      .map((row) => row.name);
    expect(agentColumns).toContain("profile_id");
    expect(agentColumns).not.toContain("agent_profile_id");

    const runColumns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('runs')")
      .all()
      .map((row) => row.name);
    expect(runColumns).toContain("agent_id");
    expect(runColumns).not.toContain("task_id");

    const scheduleColumns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('schedules')")
      .all()
      .map((row) => row.name);
    expect(scheduleColumns).toContain("agent_id");

    const workItemColumns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('work_items')")
      .all()
      .map((row) => row.name);
    expect(workItemColumns).toContain("profile_id");
    expect(workItemColumns).not.toContain("agent_profile_id");

    const runContextColumns = sqlite
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('run_context')")
      .all()
      .map((row) => row.name);
    expect(runContextColumns).toContain("agent_name");
    expect(runContextColumns).toContain("agent_description");
    expect(runContextColumns).toContain("profile_json");
    expect(runContextColumns).not.toContain("task_name");
  });

  test("creates project, agent, schedule, run, and attempt", () => {
    const database = openInMemory();
    const repos = createRepositories(database);

    const project = repos.projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
      remoteUrl: "https://example.com/demo.git",
    });

    const agent = repos.agents.create({
      projectId: project.id,
      name: "lint-fix",
      prompt: "Fix lint errors",
    });

    const schedule = repos.schedules.create({
      agentId: agent.id,
      name: "nightly",
      cronExpr: "0 2 * * *",
    });

    const run = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      scheduleId: schedule.id,
      idempotencyKey: "run-1",
      trigger: "schedule",
    });

    const attempt = repos.attempts.create({
      runId: run.id,
      attemptNumber: 1,
      workspacePath: "/tmp/workspaces/run-1",
    });

    expect(repos.projects.findById(project.id)?.name).toBe("demo");
    expect(repos.agents.findById(agent.id)?.projectId).toBe(project.id);
    expect(repos.schedules.findById(schedule.id)?.agentId).toBe(agent.id);
    expect(repos.runs.findById(run.id)?.scheduleId).toBe(schedule.id);
    expect(repos.attempts.findById(attempt.id)?.runId).toBe(run.id);
  });

  test("enforces foreign keys", () => {
    const database = openInMemory();
    const repos = createRepositories(database);

    expect(() =>
      repos.agents.create({
        projectId: "missing-project",
        name: "orphan",
        prompt: "noop",
      }),
    ).toThrow();

    const project = repos.projects.create({
      name: "fk-demo",
      repoPath: "/tmp/fk-demo",
    });

    const agent = repos.agents.create({
      projectId: project.id,
      name: "agent",
      prompt: "noop",
    });

    expect(() =>
      repos.runs.create({
        projectId: project.id,
        agentId: "missing-agent",
        idempotencyKey: "bad-run",
        trigger: "manual",
      }),
    ).toThrow();

    const run = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: "good-run",
      trigger: "manual",
    });

    expect(() =>
      repos.attempts.create({
        runId: "missing-run",
        attemptNumber: 1,
      }),
    ).toThrow();

    repos.projects.delete(project.id);

    expect(repos.agents.findById(agent.id)).toBeNull();
    expect(repos.runs.findById(run.id)).toBeNull();
  });

  test("transaction helper commits work atomically", () => {
    const database = openInMemory();
    const repos = createRepositories(database);

    const result = database.transaction(() => {
      const project = repos.projects.create({
        name: "tx",
        repoPath: "/tmp/tx",
      });
      const agent = repos.agents.create({
        projectId: project.id,
        name: "tx-agent",
        prompt: "tx",
      });
      return { project, agent };
    });

    expect(repos.projects.findById(result.project.id)).not.toBeNull();
    expect(repos.agents.findById(result.agent.id)).not.toBeNull();
  });
});
