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
import { redactSecrets } from "@/notifications/dispatcher";
import { getRunArtifacts, getRunDiff } from "@/runs/inspect";
import {
  safeParseNotificationChannelConfig,
  safeParseNotificationChannelMap,
} from "@shared/notifications";
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

import { syncProjectFromManifest } from "@/app/project-sync";
import { openApiDocument } from "./openapi";
import { listUpcomingSchedules } from "@/scheduler/upcoming";
import {
  listProjectsPage,
  listRunsPage,
  listSchedulesPage,
  listTasksPage,
} from "@/storage/paged-lists";
import { paginateArray, parsePageParamsFromUrl } from "@shared/pagination";

type RunListItem = {
  id: string;
  projectId: string;
  taskId: string;
  scheduleId: string | null;
  state: string;
  idempotencyKey: string;
  trigger: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  projectName: string | null;
  taskName: string | null;
};

function enrichRun(ctx: AppContext, run: {
  id: string;
  projectId: string;
  taskId: string;
  scheduleId: string | null;
  state: string;
  idempotencyKey: string;
  trigger: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}): RunListItem {
  const project = ctx.repos.projects.findById(run.projectId);
  const task = ctx.repos.tasks.findById(run.taskId);
  return {
    ...run,
    projectName: project?.name ?? null,
    taskName: task?.name ?? null,
  };
}

function parseEnabledParam(value: string | null): boolean | null {
  if (value == null || value === "" || value === "all") {
    return null;
  }
  if (value === "true" || value === "1" || value === "enabled") {
    return true;
  }
  if (value === "false" || value === "0" || value === "disabled") {
    return false;
  }
  return null;
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
    const page = parsePageParamsFromUrl(url);
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const all = users.listApiTokens(auth.userId).map((token) => ({
      id: token.id,
      name: token.name,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
    }));
    const filtered = q
      ? all.filter(
          (token) =>
            token.name.toLowerCase().includes(q) || token.id.toLowerCase().includes(q),
        )
      : all;
    const paged = paginateArray(filtered, page);
    return success({
      tokens: paged.items,
      total: paged.total,
      limit: paged.limit,
      offset: paged.offset,
    });
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
    const page = parsePageParamsFromUrl(url);
    const result = listProjectsPage(ctx.db, {
      ...page,
      q: url.searchParams.get("q"),
    });
    return success({
      projects: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
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
    const page = parsePageParamsFromUrl(url);
    const result = listTasksPage(ctx.db, {
      ...page,
      projectId: url.searchParams.get("projectId"),
      enabled: parseEnabledParam(url.searchParams.get("enabled")),
      q: url.searchParams.get("q"),
    });
    return success({
      tasks: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
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
    const page = parsePageParamsFromUrl(url);
    const result = listSchedulesPage(ctx.db, {
      ...page,
      projectId: url.searchParams.get("projectId"),
      enabled: parseEnabledParam(url.searchParams.get("enabled")),
      q: url.searchParams.get("q"),
    });
    return success({
      schedules: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  }

  if (method === "GET" && pathname === "/api/v1/schedules/upcoming") {
    const horizonRaw = Number(url.searchParams.get("horizonHours") ?? "168");
    const result = listUpcomingSchedules(ctx.db, {
      horizonHours: horizonRaw,
      projectId: url.searchParams.get("projectId"),
      enabled: parseEnabledParam(url.searchParams.get("enabled")),
      q: url.searchParams.get("q"),
    });
    return success(result);
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
    const page = parsePageParamsFromUrl(url);
    const result = listRunsPage(ctx.db, {
      ...page,
      projectId: url.searchParams.get("projectId"),
      taskId: url.searchParams.get("taskId"),
      state: url.searchParams.get("state"),
      trigger: url.searchParams.get("trigger"),
      q: url.searchParams.get("q"),
    });
    return success({
      runs: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  }

  const runEventsMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/events$/);
  if (method === "GET" && runEventsMatch) {
    const runId = runEventsMatch[1] ?? "";
    const run = ctx.repos.runs.findById(runId);
    if (!run) {
      return failure("not_found", "Run not found", 404);
    }

    const lastEventHeader = request.headers.get("Last-Event-ID");
    const afterId = lastEventHeader != null ? Number(lastEventHeader) : undefined;
    const afterIdOk =
      afterId != null && Number.isFinite(afterId) ? afterId : undefined;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const seen = new Set<number>();
        let unsubscribe = () => {};
        let keepalive: ReturnType<typeof setInterval> | undefined;

        const shutdown = () => {
          if (closed) {
            return;
          }
          closed = true;
          if (keepalive !== undefined) {
            clearInterval(keepalive);
          }
          unsubscribe();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        const send = (event: { id?: number; type: string; runId: string }) => {
          if (closed || event.runId !== runId) {
            return;
          }
          if (event.id != null) {
            if (seen.has(event.id)) {
              return;
            }
            seen.add(event.id);
          }
          const idLine = event.id != null ? `id: ${event.id}\n` : "";
          controller.enqueue(
            encoder.encode(`${idLine}data: ${JSON.stringify(event)}\n\n`),
          );
          if (event.type === "run.finished") {
            shutdown();
          }
        };

        // Subscribe first so events during replay are buffered, then replay.
        const liveBuffer: Array<{ id?: number; type: string; runId: string }> = [];
        let replaying = true;
        unsubscribe = ctx.eventBus.subscribe((event) => {
          if (event.runId !== runId) {
            return;
          }
          if (replaying) {
            liveBuffer.push(event);
            return;
          }
          send(event);
        });

        for (const event of ctx.eventHistory.list(runId, afterIdOk)) {
          send(event);
          if (closed) {
            return;
          }
        }
        replaying = false;
        for (const event of liveBuffer) {
          send(event);
          if (closed) {
            return;
          }
        }

        // Comment pings keep proxies from treating a quiet agent as dead.
        keepalive = setInterval(() => {
          if (closed) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
          } catch {
            shutdown();
          }
        }, 15_000);

        request.signal.addEventListener("abort", shutdown, { once: true });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
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
    return success({ run: enrichRun(ctx, run), attempts });
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
    const schedules =
      ctx.db
        .connection()
        .query<{ count: number }, []>("SELECT COUNT(*) as count FROM schedules")
        .get()?.count ?? 0;
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
    const page = parsePageParamsFromUrl(url);
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const all = listBackups(ctx.paths);
    const filtered = q
      ? all.filter(
          (backup) =>
            backup.name.toLowerCase().includes(q) || backup.path.toLowerCase().includes(q),
        )
      : all;
    const paged = paginateArray(filtered, page);
    return success({
      backups: paged.items,
      total: paged.total,
      limit: paged.limit,
      offset: paged.offset,
    });
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
    // Full map always — PUT replaces the whole map; UI pages entries client-side.
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return failure("validation_error", "channel map object is required", 400);
    }
    const parsed = safeParseNotificationChannelMap(body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join("; ");
      return failure("validation_error", message || "Invalid notification channel map", 400);
    }
    const now = new Date().toISOString();
    ctx.db
      .connection()
      .query(
        `INSERT INTO instance_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run("notification_channels", JSON.stringify(parsed.data), now);
    return success({ channels: parsed.data });
  }

  if (method === "POST" && pathname === "/api/v1/notification-channels/test") {
    const body = await readJsonBody<Record<string, unknown>>(request);
    const parsed = safeParseNotificationChannelConfig(body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join("; ");
      return failure("validation_error", message || "Invalid notification channel", 400);
    }

    const channel = {
      id: "test",
      type: parsed.data.type,
      config: {
        ...(parsed.data.config ?? {}),
        webhookUrl: parsed.data.webhookUrl,
      },
    };

    const samplePayload = {
      test: true,
      project: "gojo-test",
      task: "notification-test",
      runId: "test",
      state: "Succeeded",
      error: null,
      finishedAt: new Date().toISOString(),
    };

    try {
      await ctx.notifications.deliver(channel, samplePayload);
      return success({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const redacted = redactSecrets(message, [parsed.data.webhookUrl]);
      return failure("delivery_failed", redacted, 502);
    }
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
