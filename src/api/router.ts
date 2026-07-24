import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { resolveWebDistDir } from "./web-dist";

import { listAdapters } from "@/agents";
import { UserService } from "@/auth/users";
import type { AppContext } from "@/app/context";
import { computeScheduleNextRun } from "@/app/context";
import {
  createBackup,
  defaultBackupDest,
  listBackups,
  resolveBackupPath,
  verifyBackup,
} from "@/backup";
import { instanceDoctor, projectDoctor } from "@/diagnostics/doctor";
import { getRunArtifacts, getRunDiff } from "@/runs/inspect";
import { isTerminal } from "@shared/run-states";
import type { Schedule } from "@/storage/types";

import {
  bearerToken,
  clearSessionCookie,
  failure,
  parseCookies,
  readJsonBody,
  sessionCookie,
  SESSION_COOKIE,
  success,
  type AuthContext,
} from "./http";
import { browseRoots, listDirectory } from "@/filesystem/browse";

import { syncProjectFromManifest } from "./project-sync";
import { openApiDocument } from "./openapi";

interface ScheduleRow {
  id: string;
  task_id: string;
  name: string;
  cron_expr: string;
  timezone: string;
  enabled: number;
  overlap_policy: string;
  missed_run_policy: string;
  retry_json: string;
  consecutive_failures: number;
  disable_after: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
}

interface RunRow {
  id: string;
  project_id: string;
  task_id: string;
  schedule_id: string | null;
  state: string;
  idempotency_key: string;
  trigger: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

function mapScheduleRow(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    taskId: row.task_id,
    name: row.name,
    cronExpr: row.cron_expr,
    timezone: row.timezone,
    enabled: row.enabled !== 0,
    overlapPolicy: row.overlap_policy,
    missedRunPolicy: row.missed_run_policy,
    retryJson: row.retry_json,
    consecutiveFailures: row.consecutive_failures,
    disableAfter: row.disable_after,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
  };
}

function listAllSchedules(ctx: AppContext): Schedule[] {
  const rows = ctx.db
    .connection()
    .query<ScheduleRow, []>("SELECT * FROM schedules ORDER BY created_at")
    .all();
  return rows.map(mapScheduleRow);
}

function listRuns(ctx: AppContext, projectId?: string | null) {
  const sqlite = ctx.db.connection();
  const rows =
    projectId && projectId.length > 0
      ? sqlite
          .query<RunRow, [string]>("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC")
          .all(projectId)
      : sqlite.query<RunRow, []>("SELECT * FROM runs ORDER BY created_at DESC").all();

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    scheduleId: row.schedule_id,
    state: row.state,
    idempotencyKey: row.idempotency_key,
    trigger: row.trigger,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  }));
}

function publicUser(user: { id: string; username: string; role: string }) {
  return { id: user.id, username: user.username, role: user.role };
}

function resolveAuth(ctx: AppContext, request: Request): AuthContext | null {
  const users = new UserService(ctx.db);
  const secret = ctx.getSessionSecret();

  const token = bearerToken(request);
  if (token) {
    const user = users.verifyApiToken(token);
    if (user) {
      return { userId: user.id, username: user.username, authMethod: "token" };
    }
  }

  const cookies = parseCookies(request.headers.get("Cookie"));
  const session = cookies[SESSION_COOKIE];
  if (session) {
    const payload = users.verifySessionToken(session, secret);
    if (payload) {
      const user = users.findById(payload.userId);
      if (user) {
        return { userId: user.id, username: user.username, authMethod: "session" };
      }
    }
  }

  return null;
}

function isPublicRoute(method: string, pathname: string, hasUsers: boolean): boolean {
  if (pathname === "/api/v1/health" && method === "GET") {
    return true;
  }
  if (pathname === "/api/v1/openapi.json" && method === "GET") {
    return true;
  }
  if (pathname === "/api/v1/setup" && method === "POST" && !hasUsers) {
    return true;
  }
  if (pathname === "/api/v1/auth/login" && method === "POST") {
    return true;
  }
  if (pathname === "/api/v1/auth/logout" && method === "POST") {
    return true;
  }
  return false;
}

function isAuthExemptMutation(pathname: string): boolean {
  return pathname === "/api/v1/setup" ||
    pathname === "/api/v1/auth/login" ||
    pathname === "/api/v1/auth/logout";
}

function isMutating(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

async function serveStatic(pathname: string): Promise<Response | null> {
  const root = resolveWebDistDir();
  if (root === null) {
    return null;
  }

  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(root, safePath.replace(/^\//, ""));

  if (!filePath.startsWith(root)) {
    return null;
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return new Response(Bun.file(filePath));
  }

  const indexPath = join(root, "index.html");
  if (existsSync(indexPath)) {
    return new Response(Bun.file(indexPath));
  }

  return null;
}

export async function handleApiRequest(
  ctx: AppContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();
  const users = new UserService(ctx.db);
  const hasUsers = users.countUsers() > 0;

  if (pathname.startsWith("/api/v1")) {
    if (pathname === "/api/v1/setup" && method === "POST" && hasUsers) {
      return failure("forbidden", "Setup already completed", 403);
    }

    if (!isPublicRoute(method, pathname, hasUsers)) {
      const auth = resolveAuth(ctx, request);
      if (!auth) {
        return failure("unauthorized", "Authentication required", 401);
      }
      (request as Request & { auth?: AuthContext }).auth = auth;
    }

    if (hasUsers && isMutating(method) && !resolveAuth(ctx, request) && !isAuthExemptMutation(pathname)) {
      return failure("unauthorized", "Authentication required", 401);
    }
  }

  const auth = (request as Request & { auth?: AuthContext }).auth;

  if (method === "GET" && pathname === "/api/v1/health") {
    return success({
      status: "ok",
      paused: ctx.isPaused(),
      version: "0.1.0",
    });
  }

  if (method === "GET" && pathname === "/api/v1/openapi.json") {
    return success(openApiDocument);
  }

  if (method === "POST" && pathname === "/api/v1/setup") {
    const body = await readJsonBody<{ username?: string; password?: string }>(request);
    if (!body?.username || !body.password) {
      return failure("validation_error", "username and password are required", 400);
    }

    const user = await users.createUser(body.username, body.password, "admin");
    ctx.repos.audit.create({
      actor: user.username,
      action: "setup.complete",
      target: `user:${user.id}`,
      authMethod: "setup",
      success: true,
    });

    return success({ user: publicUser(user) }, 201);
  }

  if (method === "POST" && pathname === "/api/v1/auth/login") {
    const body = await readJsonBody<{ username?: string; password?: string }>(request);
    if (!body?.username || !body.password) {
      return failure("validation_error", "username and password are required", 400);
    }

    const user = await users.verifyCredentials(body.username, body.password);
    if (!user) {
      return failure("unauthorized", "Invalid credentials", 401);
    }

    const token = users.createSessionToken(user.id, ctx.getSessionSecret());
    return success(
      { user: publicUser(user) },
      200,
      { "Set-Cookie": sessionCookie(token, 7 * 24 * 60 * 60) },
    );
  }

  if (method === "POST" && pathname === "/api/v1/auth/logout") {
    return success({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  if (method === "GET" && pathname === "/api/v1/auth/tokens") {
    if (!auth) {
      return failure("unauthorized", "Authentication required", 401);
    }
    const tokens = users.listApiTokens(auth.userId).map((token) => ({
      id: token.id,
      name: token.name,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
    }));
    return success({ tokens });
  }

  if (method === "POST" && pathname === "/api/v1/auth/tokens") {
    if (!auth) {
      return failure("unauthorized", "Authentication required", 401);
    }
    const body = await readJsonBody<{ name?: string }>(request);
    if (!body?.name) {
      return failure("validation_error", "name is required", 400);
    }

    const created = users.createApiTokenForUser(auth.userId, body.name);
    return success(
      {
        id: created.record.id,
        name: created.record.name,
        token: created.token,
        createdAt: created.record.createdAt,
      },
      201,
    );
  }

  const tokenDeleteMatch = pathname.match(/^\/api\/v1\/auth\/tokens\/([^/]+)$/);
  if (method === "DELETE" && tokenDeleteMatch) {
    if (!auth) {
      return failure("unauthorized", "Authentication required", 401);
    }
    const tokenId = tokenDeleteMatch[1] ?? "";
    const revoked = users.revokeApiToken(auth.userId, tokenId);
    if (!revoked) {
      return failure("not_found", "Token not found", 404);
    }
    return success({ revoked: true });
  }

  if (method === "GET" && pathname === "/api/v1/projects") {
    return success({ projects: ctx.repos.projects.list() });
  }

  if (method === "POST" && pathname === "/api/v1/projects") {
    const body = await readJsonBody<{
      name?: string;
      repoPath?: string;
      defaultBranch?: string;
      remoteUrl?: string;
    }>(request);
    if (!body?.name || !body.repoPath) {
      return failure("validation_error", "name and repoPath are required", 400);
    }

    const project = ctx.repos.projects.create({
      name: body.name,
      repoPath: body.repoPath,
      ...(body.defaultBranch ? { defaultBranch: body.defaultBranch } : {}),
      ...(body.remoteUrl !== undefined ? { remoteUrl: body.remoteUrl } : {}),
    });

    return success({ project }, 201);
  }

  const projectMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)(?:\/(.+))?$/);
  if (projectMatch) {
    const projectId = projectMatch[1] ?? "";
    const action = projectMatch[2];
    const project = ctx.repos.projects.findById(projectId);
    if (!project) {
      return failure("not_found", "Project not found", 404);
    }

    if (method === "GET" && !action) {
      return success({ project });
    }

    if (method === "DELETE" && !action) {
      const removed = ctx.repos.projects.delete(projectId);
      return success({ removed });
    }

    if (method === "GET" && action === "doctor") {
      return success(projectDoctor(project));
    }

    if (method === "POST" && action === "sync") {
      const result = syncProjectFromManifest(ctx.repos, project);
      return success({ project: ctx.repos.projects.findById(projectId), sync: result });
    }
  }

  if (method === "GET" && pathname === "/api/v1/filesystem") {
    try {
      const path = url.searchParams.get("path");
      const listing = listDirectory(path);
      return success({ listing, roots: browseRoots() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure("validation_error", message, 400);
    }
  }

  if (method === "GET" && pathname === "/api/v1/agents") {
    const adapters = listAdapters();
    const detected = await Promise.all(
      adapters.map(async (adapter) => ({
        name: adapter.name,
        ...(await adapter.detect()),
      })),
    );
    return success({ agents: detected });
  }

  const agentTestMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/test$/);
  if (method === "POST" && agentTestMatch) {
    const name = decodeURIComponent(agentTestMatch[1] ?? "");
    const adapter = listAdapters().find((item) => item.name === name);
    if (!adapter) {
      return failure("not_found", "Agent not found", 404);
    }
    const result = await adapter.execute({
      workspacePath: process.cwd(),
      prompt: "#!/bin/sh\necho gojo-agent-test",
      env: {},
      timeoutMs: 10_000,
      signal: AbortSignal.timeout(10_000),
    });
    return success({ result });
  }

  if (method === "GET" && pathname === "/api/v1/tasks") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      return failure("validation_error", "projectId query parameter is required", 400);
    }
    return success({ tasks: ctx.repos.tasks.listByProject(projectId) });
  }

  if (method === "POST" && pathname === "/api/v1/tasks") {
    const body = await readJsonBody<{
      projectId?: string;
      name?: string;
      prompt?: string;
      description?: string;
      agentProfileId?: string | null;
      validationProfileJson?: string;
      integrationJson?: string;
      failurePolicyJson?: string;
      concurrencyJson?: string;
      enabled?: boolean;
    }>(request);

    if (!body?.projectId || !body.name || !body.prompt) {
      return failure("validation_error", "projectId, name, and prompt are required", 400);
    }

    const project = ctx.repos.projects.findById(body.projectId);
    if (!project) {
      return failure("not_found", "Project not found", 404);
    }

    const task = ctx.repos.tasks.create({
      projectId: body.projectId,
      name: body.name,
      prompt: body.prompt,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.agentProfileId !== undefined ? { agentProfileId: body.agentProfileId } : {}),
      ...(body.validationProfileJson !== undefined
        ? { validationProfileJson: body.validationProfileJson }
        : {}),
      ...(body.integrationJson !== undefined ? { integrationJson: body.integrationJson } : {}),
      ...(body.failurePolicyJson !== undefined
        ? { failurePolicyJson: body.failurePolicyJson }
        : {}),
      ...(body.concurrencyJson !== undefined ? { concurrencyJson: body.concurrencyJson } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });

    return success({ task }, 201);
  }

  const taskRunMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/run$/);
  if (method === "POST" && taskRunMatch) {
    const taskId = taskRunMatch[1] ?? "";
    const task = ctx.repos.tasks.findById(taskId);
    if (!task) {
      return failure("not_found", "Task not found", 404);
    }

    const run = await ctx.coordinator.createRun({
      projectId: task.projectId,
      taskId: task.id,
      trigger: "api",
    });

    void ctx.coordinator.executeRun(run.id).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ level: "error", component: "api", runId: run.id, error: message }));
    });

    return success({ run }, 202);
  }

  if (method === "GET" && pathname === "/api/v1/schedules") {
    return success({ schedules: listAllSchedules(ctx) });
  }

  const scheduleActionMatch = pathname.match(/^\/api\/v1\/schedules\/([^/]+)\/(enable|disable|pause)$/);
  if (method === "POST" && scheduleActionMatch) {
    const scheduleId = scheduleActionMatch[1] ?? "";
    const action = scheduleActionMatch[2];
    const schedule = ctx.repos.schedules.findById(scheduleId);
    if (!schedule) {
      return failure("not_found", "Schedule not found", 404);
    }

    if (action === "enable") {
      const nextRunAt = computeScheduleNextRun(schedule.cronExpr, schedule.timezone);
      const updated = ctx.repos.schedules.update(scheduleId, { enabled: true, nextRunAt });
      return success({ schedule: updated });
    }

    const updated = ctx.repos.schedules.update(scheduleId, { enabled: false });
    return success({ schedule: updated });
  }

  if (method === "GET" && pathname === "/api/v1/runs") {
    const projectId = url.searchParams.get("projectId");
    return success({ runs: listRuns(ctx, projectId) });
  }

  const runEventsMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/events$/);
  if (method === "GET" && runEventsMatch) {
    const runId = runEventsMatch[1] ?? "";
    const run = ctx.repos.runs.findById(runId);
    if (!run) {
      return failure("not_found", "Run not found", 404);
    }

    const historical = ctx.eventHistory.list(runId);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const event of historical) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }

        const unsubscribe = ctx.eventBus.subscribe((event) => {
          if (event.runId !== runId) {
            return;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (isTerminal(run.state) && event.type === "run.finished") {
            controller.close();
          }
        });

        request.signal.addEventListener(
          "abort",
          () => {
            unsubscribe();
            controller.close();
          },
          { once: true },
        );
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const runActionMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/(cancel|approve|reject|retry)$/);
  const runInspectMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/(diff|artifacts)$/);
  const runDetailMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);

  if (method === "GET" && runInspectMatch) {
    const runId = runInspectMatch[1] ?? "";
    const action = runInspectMatch[2];
    const run = ctx.repos.runs.findById(runId);
    if (!run) {
      return failure("not_found", "Run not found", 404);
    }

    if (action === "artifacts") {
      return success(getRunArtifacts(ctx, runId));
    }

    try {
      return success(await getRunDiff(ctx, runId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure("validation_error", message, 400);
    }
  }

  if (method === "GET" && runDetailMatch && !runActionMatch) {
    const runId = runDetailMatch[1] ?? "";
    const run = ctx.repos.runs.findById(runId);
    if (!run) {
      return failure("not_found", "Run not found", 404);
    }
    const attempts = ctx.repos.attempts.listByRun(runId);
    return success({ run, attempts });
  }

  if (method === "POST" && runActionMatch) {
    const runId = runActionMatch[1] ?? "";
    const action = runActionMatch[2];
    const run = ctx.repos.runs.findById(runId);
    if (!run) {
      return failure("not_found", "Run not found", 404);
    }

    if (action === "cancel") {
      await ctx.coordinator.cancelRun(runId);
      return success({ run: ctx.repos.runs.findById(runId) });
    }

    if (action === "approve") {
      await ctx.coordinator.approveRun(runId);
      return success({ run: ctx.repos.runs.findById(runId) });
    }

    if (action === "reject") {
      const body = await readJsonBody<{ reason?: string }>(request);
      await ctx.coordinator.rejectRun(runId, body?.reason);
      return success({ run: ctx.repos.runs.findById(runId) });
    }

    const retried = await ctx.coordinator.createRun({
      projectId: run.projectId,
      taskId: run.taskId,
      trigger: "manual",
    });
    void ctx.coordinator.executeRun(retried.id).catch(() => undefined);
    return success({ run: retried }, 202);
  }

  if (method === "GET" && pathname === "/api/v1/dashboard") {
    const projects = ctx.repos.projects.list().length;
    const tasks = ctx.db
      .connection()
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM tasks")
      .get()?.count ?? 0;
    const schedules = listAllSchedules(ctx).length;
    const runs = ctx.db
      .connection()
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM runs")
      .get()?.count ?? 0;
    const activeRuns = ctx.repos.runs.listNonTerminal().length;

    return success({
      projects,
      tasks,
      schedules,
      runs,
      activeRuns,
      paused: ctx.isPaused(),
    });
  }

  if (method === "GET" && pathname === "/api/v1/instance") {
    return success({
      bindHost: ctx.instance.bindHost,
      bindPort: ctx.instance.bindPort,
      paused: ctx.isPaused(),
      telemetryEnabled: ctx.instance.telemetryEnabled,
    });
  }

  if (method === "PATCH" && pathname === "/api/v1/instance") {
    const body = await readJsonBody<{ telemetryEnabled?: boolean }>(request);
    if (body?.telemetryEnabled === undefined || typeof body.telemetryEnabled !== "boolean") {
      return failure("validation_error", "telemetryEnabled boolean is required", 400);
    }
    ctx.setTelemetryEnabled(body.telemetryEnabled);
    return success({
      bindHost: ctx.instance.bindHost,
      bindPort: ctx.instance.bindPort,
      paused: ctx.isPaused(),
      telemetryEnabled: ctx.instance.telemetryEnabled,
    });
  }

  if (method === "GET" && pathname === "/api/v1/instance/doctor") {
    return success(await instanceDoctor(ctx));
  }

  if (method === "POST" && pathname === "/api/v1/instance/pause") {
    ctx.setPaused(true);
    return success({ paused: true });
  }

  if (method === "POST" && pathname === "/api/v1/instance/resume") {
    ctx.setPaused(false);
    return success({ paused: false });
  }

  if (method === "GET" && pathname === "/api/v1/backups") {
    return success({ backups: listBackups(ctx.paths) });
  }

  if (method === "POST" && pathname === "/api/v1/backups") {
    const dest = defaultBackupDest(ctx.paths);
    const result = await createBackup(ctx.paths, ctx.paths.db, dest);
    return success(result, 201);
  }

  if (method === "POST" && pathname === "/api/v1/backups/verify") {
    const body = await readJsonBody<{ path?: string }>(request);
    if (!body?.path) {
      return failure("validation_error", "path is required", 400);
    }
    try {
      const safePath = resolveBackupPath(ctx.paths, body.path);
      return success({ path: safePath, valid: await verifyBackup(safePath) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure("validation_error", message, 400);
    }
  }

  if (method === "GET" && pathname === "/api/v1/notification-channels") {
    const row = ctx.db
      .connection()
      .query<{ value_json: string }, [string]>(
        "SELECT value_json FROM instance_settings WHERE key = ?",
      )
      .get("notification_channels");
    const channels = row ? (JSON.parse(row.value_json) as Record<string, unknown>) : {};
    return success({ channels });
  }

  if (method === "PUT" && pathname === "/api/v1/notification-channels") {
    const body = await readJsonBody<Record<string, unknown>>(request);
    if (!body || typeof body !== "object") {
      return failure("validation_error", "channel map object is required", 400);
    }
    const now = new Date().toISOString();
    ctx.db
      .connection()
      .query(
        `INSERT INTO instance_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("notification_channels", JSON.stringify(body), now);
    return success({ channels: body });
  }

  if (pathname.startsWith("/api/")) {
    return failure("not_found", "Route not found", 404);
  }

  if (method === "GET") {
    const staticResponse = await serveStatic(pathname);
    if (staticResponse) {
      return staticResponse;
    }
  }

  return failure("not_found", "Route not found", 404);
}

export function createRouter(ctx: AppContext) {
  return (request: Request) => handleApiRequest(ctx, request);
}
