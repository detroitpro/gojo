import { afterEach, describe, expect, mock, test } from "bun:test";

import { Database, createRepositories } from "@/storage";
import { NotificationDispatcher, redactSecrets } from "@/notifications/dispatcher";

describe("notifications/dispatcher", () => {
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  function openDb(): { db: Database; runId: string } {
    db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });
    const task = repos.tasks.create({ projectId: project.id, name: "task", prompt: "go" });
    const run = repos.runs.create({
      projectId: project.id,
      taskId: task.id,
      idempotencyKey: "run-1",
      trigger: "manual",
    });
    return { db, runId: run.id };
  }

  test("enqueue stores pending notification", async () => {
    const { db: database, runId } = openDb();
    const dispatcher = new NotificationDispatcher(database);
    const id = await dispatcher.enqueue(
      runId,
      { id: "slack-1", type: "slack", config: { webhookUrl: "https://hooks.example/slack" } },
      { message: "hello" },
    );

    const row = database
      .connection()
      .query<{ status: string }, [string]>("SELECT status FROM notifications WHERE id = ?")
      .get(id);
    expect(row?.status).toBe("pending");
  });

  test("processQueue delivers webhook and marks sent", async () => {
    const { db: database, runId } = openDb();
    const fetchMock = mock(async () => new Response("ok", { status: 200 }));
    const dispatcher = new NotificationDispatcher(database, fetchMock as unknown as typeof fetch);

    await dispatcher.enqueue(
      runId,
      { id: "hook-1", type: "webhook", config: { webhookUrl: "https://hooks.example/hook" } },
      { event: "run.failed" },
    );

    const processed = await dispatcher.processQueue();
    expect(processed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const row = database
      .connection()
      .query<{ status: string; sent_at: string | null }, []>(
        "SELECT status, sent_at FROM notifications LIMIT 1",
      )
      .get();
    expect(row?.status).toBe("sent");
    expect(row?.sent_at).not.toBeNull();
  });

  test("processQueue retries failures with backoff and redacts secrets", async () => {
    const { db: database, runId } = openDb();
    const secretUrl = "https://hooks.example/secret-token";
    const fetchMock = mock(async () => new Response("nope", { status: 500 }));
    const dispatcher = new NotificationDispatcher(database, fetchMock as unknown as typeof fetch);

    await dispatcher.enqueue(
      runId,
      { id: "hook-1", type: "webhook", config: { webhookUrl: secretUrl } },
      { event: "run.failed" },
    );

    await dispatcher.processQueue();
    const row = database
      .connection()
      .query<{ attempts: number; last_error: string | null }, []>(
        "SELECT attempts, last_error FROM notifications LIMIT 1",
      )
      .get();

    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toContain("500");
    expect(row?.last_error).not.toContain("secret-token");
    expect(redactSecrets(`failed ${secretUrl}`, [secretUrl])).toBe("failed ***");
  });

  test("deliver throws for missing webhook URL", async () => {
    const { db: database } = openDb();
    const dispatcher = new NotificationDispatcher(database);

    await expect(
      dispatcher.deliver({ id: "bad", type: "webhook", config: {} }, { ok: true }),
    ).rejects.toThrow("Missing webhookUrl");
  });
});
