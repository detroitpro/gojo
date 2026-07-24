import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database, createRepositories } from "@/storage";

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

  test("creates project, task, schedule, run, and attempt", () => {
    const database = openInMemory();
    const repos = createRepositories(database);

    const project = repos.projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
      remoteUrl: "https://example.com/demo.git",
    });

    const task = repos.tasks.create({
      projectId: project.id,
      name: "lint-fix",
      prompt: "Fix lint errors",
    });

    const schedule = repos.schedules.create({
      taskId: task.id,
      name: "nightly",
      cronExpr: "0 2 * * *",
    });

    const run = repos.runs.create({
      projectId: project.id,
      taskId: task.id,
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
    expect(repos.tasks.findById(task.id)?.projectId).toBe(project.id);
    expect(repos.schedules.findById(schedule.id)?.taskId).toBe(task.id);
    expect(repos.runs.findById(run.id)?.scheduleId).toBe(schedule.id);
    expect(repos.attempts.findById(attempt.id)?.runId).toBe(run.id);
  });

  test("enforces foreign keys", () => {
    const database = openInMemory();
    const repos = createRepositories(database);

    expect(() =>
      repos.tasks.create({
        projectId: "missing-project",
        name: "orphan",
        prompt: "noop",
      }),
    ).toThrow();

    const project = repos.projects.create({
      name: "fk-demo",
      repoPath: "/tmp/fk-demo",
    });

    const task = repos.tasks.create({
      projectId: project.id,
      name: "task",
      prompt: "noop",
    });

    expect(() =>
      repos.runs.create({
        projectId: project.id,
        taskId: "missing-task",
        idempotencyKey: "bad-run",
        trigger: "manual",
      }),
    ).toThrow();

    const run = repos.runs.create({
      projectId: project.id,
      taskId: task.id,
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

    expect(repos.tasks.findById(task.id)).toBeNull();
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
      const task = repos.tasks.create({
        projectId: project.id,
        name: "tx-task",
        prompt: "tx",
      });
      return { project, task };
    });

    expect(repos.projects.findById(result.project.id)).not.toBeNull();
    expect(repos.tasks.findById(result.task.id)).not.toBeNull();
  });
});
