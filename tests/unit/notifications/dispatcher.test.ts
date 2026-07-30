import { afterEach, describe, expect, mock, test } from "bun:test";

import { Database, createRepositories } from "@/storage";
import {
  formatTelegramText,
  NotificationDispatcher,
  redactSecrets,
  renderTelegramHtml,
} from "@/notifications/dispatcher";

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
    const task = repos.agents.create({ projectId: project.id, name: "task", prompt: "go" });
    const run = repos.runs.create({
      projectId: project.id,
      agentId: task.id,
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

  test("deliver telegram calls Bot API sendMessage", async () => {
    const { db: database } = openDb();
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://api.telegram.org/bot123:TOKEN/sendMessage");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        chat_id: string;
        text: string;
        parse_mode: string;
        disable_web_page_preview: boolean;
      };
      expect(body.chat_id).toBe("-1001");
      expect(body.parse_mode).toBe("HTML");
      expect(body.text).toContain("gojo: Failed");
      expect(body.text).toContain("demo / nightly");
      expect(body.text).toContain("<b>Broken self-heal</b>");
      expect(body.text).toContain("compare a &lt; b");
      expect(body.disable_web_page_preview).toBe(true);
      return new Response("{}", { status: 200 });
    });
    const dispatcher = new NotificationDispatcher(database, fetchMock as unknown as typeof fetch);

    await dispatcher.deliver(
      {
        id: "tg",
        type: "telegram",
        config: { botToken: "123:TOKEN", chatId: "-1001" },
      },
      {
        project: "demo",
        agent: "nightly",
        runId: "01ABC",
        state: "Failed",
        error: "boom",
        summary: "**Broken self-heal**\n\ncompare a < b",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("telegram delivery redacts bot token in queue errors", async () => {
    const { db: database, runId } = openDb();
    const token = "123:SECRETTOKEN";
    const fetchMock = mock(async () => new Response(`bad ${token}`, { status: 401 }));
    const dispatcher = new NotificationDispatcher(database, fetchMock as unknown as typeof fetch);

    await dispatcher.enqueue(
      runId,
      { id: "tg", type: "telegram", config: { botToken: token, chatId: "42" } },
      { state: "Failed" },
    );

    await dispatcher.processQueue();
    const row = database
      .connection()
      .query<{ last_error: string | null }, []>(
        "SELECT last_error FROM notifications LIMIT 1",
      )
      .get();
    expect(row?.last_error).toContain("401");
    expect(row?.last_error).not.toContain("SECRETTOKEN");
  });

  test("formatTelegramText builds a short message", () => {
    expect(
      formatTelegramText({
        project: "gojo",
        agent: "maintain-tests",
        runId: "01X",
        state: "Succeeded",
      }),
    ).toBe("gojo: Succeeded\ngojo / maintain-tests\nrun 01X");
  });

  test("formatTelegramText appends the agent summary as the message body", () => {
    expect(
      formatTelegramText({
        project: "gojo",
        agent: "activity-digest",
        runId: "01X",
        state: "Succeeded",
        summary: "gojo — last 24h\n\nMerged (1)\n- #21 fix",
      }),
    ).toBe(
      "gojo: Succeeded\ngojo / activity-digest\nrun 01X\n\ngojo — last 24h\n\nMerged (1)\n- #21 fix",
    );
  });

  test("formatTelegramText truncates past the Telegram limit", () => {
    const text = formatTelegramText({
      project: "gojo",
      agent: "activity-digest",
      runId: "01X",
      state: "Succeeded",
      summary: "x".repeat(5000),
    });

    expect(text.length).toBe(4096);
    expect(text.endsWith("… truncated")).toBe(true);
  });

  test("renderTelegramHtml escapes markup then converts **bold** markers", () => {
    expect(renderTelegramHtml("compare a < b & c > d")).toBe("compare a &lt; b &amp; c &gt; d");
    expect(renderTelegramHtml("**Header**\n\ndetail with `src/foo.ts`")).toBe(
      "<b>Header</b>\n\ndetail with `src/foo.ts`",
    );
    expect(renderTelegramHtml("**A** and **B**")).toBe("<b>A</b> and <b>B</b>");
  });
});
