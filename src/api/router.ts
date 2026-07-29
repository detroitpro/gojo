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
import { WS_PATH } from "@shared/ws";
import {
  clearSessionCookie,
  failure,
  readJsonBody,
  sessionCookie,
  success,
  type AuthContext,
} from "./http";
import { isScopedAgentToken, resolveAuth, scopedTokenAllows } from "./auth";
import type { WsConnectionData } from "./ws/types";
import { browseRoots, listDirectory } from "@/filesystem/browse";

import { syncProjectFromManifest } from "@/app/project-sync";
import { defaultSourceAdapters, ensureProjectRepositorySource } from "@/sources";
import {
  getInstanceSetting,
  getSchedulingPolicy,
  setInstanceSetting,
  setSchedulingPolicy,
} from "@/app/instance-settings";
import { openApiDocument } from "./openapi";
import { listUpcomingSchedules } from "@/scheduler/upcoming";
import { getDashboardOverview } from "@/storage/dashboard-overview";
import { getDashboardImpact } from "@/storage/impact-analytics";
import {
  BACKUP_SORT_ALLOWED,
  getTaskDetail,
  IMPACT_ITEM_SORT_ALLOWED,
  INTEGRATION_LIST_STATUSES,
  INTEGRATION_SORT_ALLOWED,
  listImpactItemsPage,
  listIntegrationsPage,
  listProjectsPage,
  toProjectDetailRow,
  listRunsPage,
  listSchedulesPage,
  listTasksPage,
  PROJECT_SORT_ALLOWED,
  type IntegrationListStatus,
  QUEUE_SORT_ALLOWED,
  RUN_SORT_ALLOWED,
  SCHEDULE_SORT_ALLOWED,
  TASK_SORT_ALLOWED,
  TOKEN_SORT_ALLOWED,
} from "@/storage/paged-lists";
import {
  compareSortValues,
  paginateArray,
  parsePageParamsFromUrl,
  parseSortParamsFromUrl,
} from "@shared/pagination";
import { safeParseSchedulingPolicy } from "@shared/scheduling";
import {
  compareWindowToMs,
  parseCompareWindow,
  type WorkAttention,
  type WorkDelivery,
  type WorkExecution,
  type WorkOutcome,
  type WorkProvenance,
} from "@shared/work";
import { parseImpactRange } from "@/storage/impact-analytics";
import { createWorkStatusRollup } from "@/storage/work-status-rollup";

/** Minimal Bun.Server surface needed for WebSocket upgrades. */
export type UpgradeServer = {
  upgrade(
    request: Request,
    options: { data: WsConnectionData; headers?: HeadersInit },
  ): boolean;
};

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

function parseWorkProvenance(value: string | null): WorkProvenance | null {
  return value === "gojo-agent" ||
    value === "human" ||
    value === "bot" ||
    value === "external"
    ? value
    : null;
}

function parseWorkDelivery(value: string | null): WorkDelivery | null {
  return value === "none" ||
    value === "draft" ||
    value === "open" ||
    value === "review" ||
    value === "blocked" ||
    value === "merged" ||
    value === "closed"
    ? value
    : null;
}

function parseWorkAttention(value: string | null): WorkAttention | null {
  return value === "none" ||
    value === "approval" ||
    value === "blocked" ||
    value === "sync-error" ||
    value === "stale"
    ? value
    : null;
}

function parseWorkExecution(value: string | null): WorkExecution | null {
  const allowed: WorkExecution[] = [
    "queued",
    "preparing",
    "running",
    "validating",
    "awaiting-approval",
    "integrating",
    "reporting",
    "terminal",
    "none",
  ];
  return allowed.includes(value as WorkExecution) ? (value as WorkExecution) : null;
}

function parseWorkOutcome(value: string | null): WorkOutcome | null {
  const allowed: WorkOutcome[] = [
    "pending",
    "succeeded",
    "failed",
    "no-change",
    "canceled",
  ];
  return allowed.includes(value as WorkOutcome) ? (value as WorkOutcome) : null;
}

function publicUser(user: { id: string; username: string; role: string }) {
  return { id: user.id, username: user.username, role: user.role };
}

function isPublicRoute(method: string, pathname: string, hasUsers: boolean): boolean {
  if (method === "POST" && /^\/api\/v1\/sources\/[^/]+\/events$/.test(pathname)) {
    return true;
  }
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
    pathname === "/api/v1/auth/logout" ||
    /^\/api\/v1\/sources\/[^/]+\/events$/.test(pathname);
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
  server?: UpgradeServer,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();
  const users = new UserService(ctx.db);
  const hasUsers = users.countUsers() > 0;

  if (pathname === WS_PATH && method === "GET") {
    if (!server) {
      return failure("bad_request", "WebSocket upgrade requires server", 400);
    }
    const auth = resolveAuth(ctx, request);
    if (!auth) {
      return failure("unauthorized", "Authentication required", 401);
    }
    if (isScopedAgentToken(auth)) {
      return failure("forbidden", "Scoped agent tokens cannot open WebSocket", 403);
    }
    const headers = new Headers();
    const cookie = request.headers.get("Cookie");
    const authorization = request.headers.get("Authorization");
    if (cookie) headers.set("Cookie", cookie);
    if (authorization) headers.set("Authorization", authorization);
    const upgraded = server.upgrade(request, {
      data: {
        auth,
        headers,
        origin: `${url.protocol}//${url.host}`,
      },
    });
    if (!upgraded) {
      return failure("bad_request", "WebSocket upgrade failed", 400);
    }
    // Bun completes the handshake; do not return a Response.
    return undefined;
  }

  if (pathname.startsWith("/api/v1")) {
    if (pathname === "/api/v1/setup" && method === "POST" && hasUsers) {
      return failure("forbidden", "Setup already completed", 403);
    }

    if (!isPublicRoute(method, pathname, hasUsers)) {
      const auth = resolveAuth(ctx, request);
      if (!auth) {
        return failure("unauthorized", "Authentication required", 401);
      }
      if (!scopedTokenAllows(auth, method, pathname)) {
        return failure("forbidden", "Token scope does not allow this operation", 403);
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
    const { sort, order } = parseSortParamsFromUrl(url, {
      allowed: TOKEN_SORT_ALLOWED,
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const includeAgent = url.searchParams.get("includeAgent") === "1";
    const all = users
      .listApiTokens(auth.userId)
      .filter((token) => includeAgent || !token.name.startsWith("agent-run-"))
      .map((token) => ({
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
    const sorted = [...filtered].sort((a, b) => {
      const key = sort as keyof typeof a;
      return compareSortValues(a[key], b[key], order);
    });
    const paged = paginateArray(sorted, page);
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
    const sort = parseSortParamsFromUrl(url, {
      allowed: PROJECT_SORT_ALLOWED,
      defaultSort: "createdAt",
      defaultOrder: "asc",
    });
    const hasOpenPrsParam = url.searchParams.get("hasOpenPrs");
    const hasOpenPrs =
      hasOpenPrsParam === "true" || hasOpenPrsParam === "1"
        ? true
        : hasOpenPrsParam === "false" || hasOpenPrsParam === "0"
          ? false
          : null;
    const result = listProjectsPage(ctx.db, {
      ...page,
      ...sort,
      q: url.searchParams.get("q"),
      hasOpenPrs,
    });
    return success({
      projects: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  }

  if (method === "GET" && pathname === "/api/v1/integrations") {
    const statusParam = url.searchParams.get("status");
    if (
      statusParam !== "open" &&
      statusParam !== "merged" &&
      statusParam !== "committed"
    ) {
      return failure(
        "validation_error",
        `status is required (${INTEGRATION_LIST_STATUSES.join("|")})`,
        400,
      );
    }
    const status = statusParam as IntegrationListStatus;
    const page = parsePageParamsFromUrl(url);
    const defaultSort =
      status === "merged" ? "mergedAt" : status === "committed" ? "createdAt" : "openedAt";
    const sort = parseSortParamsFromUrl(url, {
      allowed: INTEGRATION_SORT_ALLOWED,
      defaultSort,
      defaultOrder: "desc",
    });
    const result = listIntegrationsPage(ctx.db, {
      ...page,
      ...sort,
      status,
      projectId: url.searchParams.get("projectId"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    return success({
      integrations: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  }

  if (method === "GET" && pathname === "/api/v1/impact/items") {
    const page = parsePageParamsFromUrl(url);
    const sort = parseSortParamsFromUrl(url, {
      allowed: IMPACT_ITEM_SORT_ALLOWED,
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const result = listImpactItemsPage(ctx.db, {
      ...page,
      ...sort,
      category: url.searchParams.get("category"),
      projectId: url.searchParams.get("projectId"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    return success({
      items: result.items,
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
    try {
      ensureProjectRepositorySource(ctx.db, project.id);
    } catch {
      // Repository discovery is best-effort; source health exposes failures.
    }
    ctx.platformEvents.append({
      projectId: project.id,
      type: "project.created",
      entityKind: "project",
      entityId: project.id,
      topics: ["dashboard", "overview", "projects", "sources"],
    });

    return success({ project: toProjectDetailRow(ctx.db, project) }, 201);
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
      return success({ project: toProjectDetailRow(ctx.db, project) });
    }

    if (method === "DELETE" && !action) {
      const removed = ctx.repos.projects.delete(projectId);
      if (removed) {
        ctx.platformEvents.append({
          projectId,
          type: "project.deleted",
          entityKind: "project",
          entityId: projectId,
          topics: ["dashboard", "overview", "impact", "projects"],
        });
      }
      return success({ removed });
    }

    if (method === "GET" && action === "doctor") {
      return success(await projectDoctor(project, ctx.repos));
    }

    if (method === "GET" && action === "work") {
      const page = parsePageParamsFromUrl(url);
      const historyParam = url.searchParams.get("history");
      return success(
        ctx.work.items.listByProject(projectId, {
          ...page,
          kind: url.searchParams.get("kind"),
          provenance: parseWorkProvenance(url.searchParams.get("provenance")),
          delivery: parseWorkDelivery(url.searchParams.get("delivery")),
          attention: parseWorkAttention(url.searchParams.get("attention")),
          execution: parseWorkExecution(url.searchParams.get("execution")),
          outcome: parseWorkOutcome(url.searchParams.get("outcome")),
          sourceId: url.searchParams.get("sourceId"),
          actor: url.searchParams.get("actor"),
          label: url.searchParams.get("label"),
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          q: url.searchParams.get("q"),
          history: historyParam === "1" || historyParam === "true",
        }),
      );
    }

    if (method === "GET" && action === "work/status") {
      const compareWindow = parseCompareWindow(url.searchParams.get("compare"));
      return success(ctx.work.items.status(projectId, { compareWindow }));
    }

    if (method === "GET" && action === "sources") {
      const sources = ctx.work.sources.listByProject(projectId).map((source) => ({
        ...source,
        connection: source.connectionId
          ? ctx.work.connections.findById(source.connectionId)
          : null,
        cursor: ctx.work.sync.cursor(source.id),
      }));
      return success({ sources });
    }

    if (method === "POST" && action === "sources") {
      const body = await readJsonBody<{
        name?: string;
        adapter?: string;
        baseUrl?: string | null;
        config?: Record<string, unknown>;
        kind?: string;
        externalKey?: string;
        displayName?: string;
        webUrl?: string | null;
      }>(request);
      const adapter = defaultSourceAdapters().find(
        (candidate) => candidate.type === body?.adapter,
      );
      if (!body?.name || !adapter || !body.kind || !body.externalKey) {
        return failure(
          "validation_error",
          "name, supported adapter, kind, and externalKey are required",
          400,
        );
      }
      const connection = ctx.work.connections.create({
        name: body.name,
        adapter: adapter.type,
        baseUrl: body.baseUrl ?? null,
        configJson: JSON.stringify(body.config ?? {}),
        capabilities: adapter.capabilities,
      });
      const source = ctx.work.sources.create({
        projectId,
        connectionId: connection.id,
        kind: body.kind,
        externalKey: body.externalKey,
        displayName: body.displayName ?? body.externalKey,
        webUrl: body.webUrl ?? null,
      });
      ctx.platformEvents.append({
        projectId,
        type: "source.attached",
        entityKind: "source",
        entityId: source.id,
        topics: ["dashboard", "projects", "work", "sources"],
      });
      return success({ source, connection }, 201);
    }

    const sourceRefreshMatch = action?.match(/^sources\/([^/]+)\/refresh$/);
    if (method === "POST" && sourceRefreshMatch) {
      const sourceId = sourceRefreshMatch[1] ?? "";
      const source = ctx.work.sources.findById(sourceId);
      if (!source || source.projectId !== projectId) {
        return failure("not_found", "Project source not found", 404);
      }
      return success({ sync: await ctx.sourceSync.syncSource(sourceId) }, 202);
    }

    if (method === "POST" && action === "sync") {
      const result = syncProjectFromManifest(ctx.repos, project);
      ensureProjectRepositorySource(ctx.db, project.id);
      const refreshed = ctx.repos.projects.findById(projectId);
      ctx.platformEvents.append({
        projectId,
        type: "project.synced",
        entityKind: "project",
        entityId: projectId,
        topics: [
          "dashboard",
          "overview",
          "projects",
          "tasks",
          "schedules",
          "work",
          "sources",
        ],
        data: result,
      });
      return success({
        project: refreshed ? toProjectDetailRow(ctx.db, refreshed) : null,
        sync: result,
      });
    }
  }

  const workActionMatch = pathname.match(/^\/api\/v1\/work\/([^/]+)(?:\/(recheck|resolve))?$/);
  if (workActionMatch) {
    const workItemId = workActionMatch[1] ?? "";
    const action = workActionMatch[2] ?? null;
    const work = ctx.work.items.findById(workItemId);
    if (!work) return failure("not_found", "Work item not found", 404);

    if (method === "GET" && !action) {
      return success({
        work,
        links: ctx.work.links.listByWorkItem(workItemId),
        events: ctx.work.events.listByWorkItem(workItemId),
        runContext:
          work.kind === "run" && work.nativeKey
            ? ctx.work.runContexts.findByRun(work.nativeKey)
            : null,
      });
    }

    if (method === "POST" && action === "recheck") {
      try {
        return success({
          result: await ctx.sourceSync.recheckWorkItem(workItemId),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure("validation_error", message, 400);
      }
    }

    if (method === "POST" && action === "resolve") {
      const body = await readJsonBody<{
        resolvedBy?: string | null;
        note?: string | null;
      }>(request);
      const auth = (request as Request & { auth?: AuthContext }).auth;
      try {
        return success({
          work: ctx.sourceSync.resolveWorkItem(workItemId, {
            resolvedBy: body?.resolvedBy ?? auth?.username ?? null,
            note: body?.note ?? null,
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure("validation_error", message, 400);
      }
    }
  }

  const sourceEventsMatch = pathname.match(/^\/api\/v1\/sources\/([^/]+)\/events$/);
  if (method === "POST" && sourceEventsMatch) {
    try {
      const sourceId = sourceEventsMatch[1] ?? "";
      const body = await request.text();
      const signature = request.headers.get("X-Gojo-Signature") ?? "";
      return success(await ctx.sourceWebhooks.ingest(sourceId, body, signature), 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure("validation_error", message, 400);
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
    const sort = parseSortParamsFromUrl(url, {
      allowed: TASK_SORT_ALLOWED,
      defaultSort: "name",
      defaultOrder: "asc",
    });
    const result = listTasksPage(ctx.db, {
      ...page,
      ...sort,
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
    ctx.platformEvents.append({
      projectId: task.projectId,
      type: "task.created",
      entityKind: "task",
      entityId: task.id,
      topics: ["dashboard", "overview", "projects", "tasks"],
    });

    return success({ task }, 201);
  }

  const taskGetMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/);
  if (method === "GET" && taskGetMatch) {
    const taskId = taskGetMatch[1] ?? "";
    const task = getTaskDetail(ctx.db, taskId);
    if (!task) {
      return failure("not_found", "Task not found", 404);
    }
    return success({ task });
  }

  const taskRunMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/run$/);
  if (method === "POST" && taskRunMatch) {
    const taskId = taskRunMatch[1] ?? "";
    const task = ctx.repos.tasks.findById(taskId);
    if (!task) {
      return failure("not_found", "Task not found", 404);
    }

    const run = await ctx.coordinator.enqueueRun({
      projectId: task.projectId,
      taskId: task.id,
      trigger: "api",
    });
    ctx.dispatcher.kick();

    return success({ run }, 202);
  }

  const taskActionMatch = pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/(enable|disable)$/);
  if (method === "POST" && taskActionMatch) {
    const taskId = taskActionMatch[1] ?? "";
    const action = taskActionMatch[2];
    const task = ctx.repos.tasks.findById(taskId);
    if (!task) {
      return failure("not_found", "Task not found", 404);
    }

    const updated = ctx.repos.tasks.update(taskId, { enabled: action === "enable" });
    ctx.platformEvents.append({
      projectId: task.projectId,
      type: "task.updated",
      entityKind: "task",
      entityId: task.id,
      topics: ["dashboard", "overview", "projects", "tasks"],
      data: { enabled: action === "enable" },
    });
    return success({ task: updated });
  }

  if (method === "GET" && pathname === "/api/v1/schedules") {
    const page = parsePageParamsFromUrl(url);
    const sort = parseSortParamsFromUrl(url, {
      allowed: SCHEDULE_SORT_ALLOWED,
      defaultSort: "createdAt",
      defaultOrder: "asc",
    });
    const result = listSchedulesPage(ctx.db, {
      ...page,
      ...sort,
      projectId: url.searchParams.get("projectId"),
      taskId: url.searchParams.get("taskId"),
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
    const scheduleProjectId = ctx.repos.tasks.findById(schedule.taskId)?.projectId ?? null;

    if (action === "enable") {
      const nextRunAt = computeScheduleNextRun(schedule.cronExpr, schedule.timezone);
      const updated = ctx.repos.schedules.update(scheduleId, { enabled: true, nextRunAt });
      ctx.platformEvents.append({
        projectId: scheduleProjectId,
        type: "schedule.updated",
        entityKind: "schedule",
        entityId: schedule.id,
        topics: ["dashboard", "overview", "projects", "schedules"],
        data: { enabled: true },
      });
      return success({ schedule: updated });
    }

    const updated = ctx.repos.schedules.update(scheduleId, { enabled: false });
    ctx.platformEvents.append({
      projectId: scheduleProjectId,
      type: "schedule.updated",
      entityKind: "schedule",
      entityId: schedule.id,
      topics: ["dashboard", "overview", "projects", "schedules"],
      data: { enabled: false },
    });
    return success({ schedule: updated });
  }

  if (method === "GET" && pathname === "/api/v1/runs") {
    const page = parsePageParamsFromUrl(url);
    const sort = parseSortParamsFromUrl(url, {
      allowed: RUN_SORT_ALLOWED,
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const result = listRunsPage(ctx.db, {
      ...page,
      ...sort,
      projectId: url.searchParams.get("projectId"),
      taskId: url.searchParams.get("taskId"),
      state: url.searchParams.get("state"),
      trigger: url.searchParams.get("trigger"),
      q: url.searchParams.get("q"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    return success({
      runs: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  }

  const runActionMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/(cancel|approve|reject|retry)$/);
  const runInspectMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/(diff|artifacts)$/);
  const runProgressMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/progress$/);
  const runDetailMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);

  if (method === "POST" && runProgressMatch) {
    const runId = runProgressMatch[1] ?? "";
    const body = await readJsonBody<{
      title?: string;
      summary?: string;
      blockedReason?: string | null;
      references?: string[];
    }>(request);
    if (!body?.title?.trim() || !body.summary?.trim()) {
      return failure("validation_error", "title and summary are required", 400);
    }
    try {
      const run = ctx.coordinator.updateProgress(runId, {
        title: body.title.trim(),
        summary: body.summary.trim(),
        blockedReason: body.blockedReason ?? null,
        references: Array.isArray(body.references)
          ? body.references.filter((value): value is string => typeof value === "string")
          : [],
      });
      return success({ run: enrichRun(ctx, run) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure("not_found", message, 404);
    }
  }

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
    return success({
      run: enrichRun(ctx, run),
      attempts,
      impactItems: ctx.repos.runImpactItems.listByRun(runId),
      integration: ctx.repos.runIntegrations.findByRun(runId),
    });
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

    const retried = await ctx.coordinator.enqueueRun({
      projectId: run.projectId,
      taskId: run.taskId,
      trigger: "manual",
    });
    ctx.dispatcher.kick();
    return success({ run: retried }, 202);
  }

  if (method === "GET" && pathname === "/api/v1/queue") {
    const page = parsePageParamsFromUrl(url);
    const { sort, order } = parseSortParamsFromUrl(url, {
      allowed: QUEUE_SORT_ALLOWED,
      defaultSort: "position",
      defaultOrder: "asc",
    });
    const policy = getSchedulingPolicy(ctx.db);
    const queued = ctx.repos.runs.listQueued();
    const runningByProject = ctx.repos.runs.countRunningByProject();
    const runningCount = Object.values(runningByProject).reduce((a, b) => a + b, 0);
    const waitingRows = queued.map((run, index) => {
      const project = ctx.repos.projects.findById(run.projectId);
      const task = ctx.repos.tasks.findById(run.taskId);
      return {
        runId: run.id,
        projectId: run.projectId,
        projectName: project?.name ?? null,
        taskId: run.taskId,
        taskName: task?.name ?? null,
        trigger: run.trigger,
        priority: run.priority,
        notBeforeAt: run.notBeforeAt,
        expiresAt: run.expiresAt,
        createdAt: run.createdAt,
        position: index + 1,
      };
    });
    const sortedWaiting = [...waitingRows].sort((a, b) => {
      const key = sort as keyof typeof a;
      return compareSortValues(a[key], b[key], order);
    });
    const paged = paginateArray(sortedWaiting, page);
    const running = ctx.repos.runs
      .listNonTerminal()
      .filter((run) =>
        ["Preparing", "Running", "Validating", "AwaitingApproval", "Integrating", "Reporting"].includes(
          run.state,
        ),
      )
      .map((run) => {
        const project = ctx.repos.projects.findById(run.projectId);
        const task = ctx.repos.tasks.findById(run.taskId);
        return {
          runId: run.id,
          projectId: run.projectId,
          projectName: project?.name ?? null,
          taskId: run.taskId,
          taskName: task?.name ?? null,
          state: run.state,
          admittedAt: run.admittedAt,
        };
      });

    return success({
      policy,
      counts: { running: runningCount, waiting: waitingRows.length },
      waiting: paged.items,
      total: paged.total,
      limit: paged.limit,
      offset: paged.offset,
      running,
    });
  }

  if (method === "GET" && pathname === "/api/v1/instance/scheduling") {
    return success({ policy: getSchedulingPolicy(ctx.db) });
  }

  if (method === "PATCH" && pathname === "/api/v1/instance/scheduling") {
    const body = await readJsonBody<unknown>(request);
    const parsed = safeParseSchedulingPolicy(body);
    if (!parsed.success) {
      return failure("validation_error", parsed.error.message, 400);
    }
    const policy = setSchedulingPolicy(ctx.db, parsed.data);
    ctx.dispatcher.kick();
    ctx.platformEvents.append({
      type: "scheduling.updated",
      entityKind: "instance",
      entityId: "scheduling",
      topics: ["dashboard", "overview", "queue"],
      data: policy,
    });
    return success({ policy });
  }

  if (method === "GET" && pathname === "/api/v1/dashboard") {
    const compareWindow = parseCompareWindow(url.searchParams.get("compare"));
    const projects = ctx.repos.projects.list().length;
    const tasks = ctx.repos.tasks.count();
    const schedules = ctx.repos.schedules.count();
    const runs = ctx.repos.runs.count();
    const activeRuns = ctx.repos.runs.listNonTerminal().length;
    const waitingRuns = ctx.repos.runs.listQueued().length;
    const runningByProject = ctx.repos.runs.countRunningByProject();
    const runningRuns = Object.values(runningByProject).reduce((a, b) => a + b, 0);
    const policy = getSchedulingPolicy(ctx.db);

    const previousAsOf = new Date(
      Date.now() - compareWindowToMs(compareWindow),
    ).toISOString();
    const rollup = createWorkStatusRollup(ctx.db);
    const hasRunHistory =
      ctx.db
        .connection()
        .query<{ n: number }, []>(
          `SELECT COUNT(*) AS n FROM work_events
           WHERE execution IS NOT NULL
             AND json_extract(data_json, '$.kind') = 'run'`,
        )
        .get()?.n ?? 0;
    const previousRunCounts =
      hasRunHistory > 0 ? rollup.countsAtKind("run", previousAsOf) : null;
    const previousRunsTotal =
      ctx.db
        .connection()
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM runs WHERE created_at <= ?",
        )
        .get(previousAsOf)?.n ?? 0;

    return success({
      projects,
      tasks,
      schedules,
      runs,
      activeRuns,
      runningRuns,
      waitingRuns,
      schedulingPolicy: policy,
      paused: ctx.isPaused(),
      previous: previousRunCounts
        ? {
            runningRuns: previousRunCounts.working,
            waitingRuns: previousRunCounts.queued,
            runs: previousRunsTotal,
            asOf: previousAsOf,
            compareWindow,
          }
        : null,
    });
  }

  if (method === "GET" && pathname === "/api/v1/dashboard/overview") {
    return success(getDashboardOverview(ctx.db));
  }

  if (method === "GET" && pathname === "/api/v1/dashboard/impact") {
    const range = parseImpactRange(url.searchParams.get("range"));
    return success(
      getDashboardImpact(ctx.db, {
        projectId: url.searchParams.get("projectId"),
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        range,
      }),
    );
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
    ctx.platformEvents.append({
      type: "instance.updated",
      entityKind: "instance",
      entityId: "instance",
      topics: ["dashboard"],
      data: { telemetryEnabled: body.telemetryEnabled },
    });
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
    ctx.platformEvents.append({
      type: "instance.paused",
      entityKind: "instance",
      entityId: "instance",
      topics: ["dashboard", "overview", "queue"],
      data: { paused: true },
    });
    return success({ paused: true });
  }

  if (method === "POST" && pathname === "/api/v1/instance/resume") {
    ctx.setPaused(false);
    ctx.platformEvents.append({
      type: "instance.resumed",
      entityKind: "instance",
      entityId: "instance",
      topics: ["dashboard", "overview", "queue"],
      data: { paused: false },
    });
    return success({ paused: false });
  }

  if (method === "GET" && pathname === "/api/v1/backups") {
    const page = parsePageParamsFromUrl(url);
    const { sort, order } = parseSortParamsFromUrl(url, {
      allowed: BACKUP_SORT_ALLOWED,
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const all = listBackups(ctx.paths);
    const filtered = q
      ? all.filter(
          (backup) =>
            backup.name.toLowerCase().includes(q) || backup.path.toLowerCase().includes(q),
        )
      : all;
    const sorted = [...filtered].sort((a, b) => {
      const key = sort as keyof typeof a;
      return compareSortValues(a[key], b[key], order);
    });
    const paged = paginateArray(sorted, page);
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
    const value = getInstanceSetting(ctx.db, "notification_channels");
    const channels =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
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
    setInstanceSetting(ctx.db, "notification_channels", parsed.data);
    return success({ channels: parsed.data });
  }

  if (method === "POST" && pathname === "/api/v1/notification-channels/test") {
    const body = await readJsonBody<Record<string, unknown>>(request);
    const parsed = safeParseNotificationChannelConfig(body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join("; ");
      return failure("validation_error", message || "Invalid notification channel", 400);
    }

    const channelConfig =
      parsed.data.type === "telegram"
        ? {
            botToken: parsed.data.botToken,
            chatId: parsed.data.chatId,
            ...(parsed.data.config ?? {}),
          }
        : {
            webhookUrl: parsed.data.webhookUrl,
            ...(parsed.data.config ?? {}),
          };

    const channel = {
      id: "test",
      type: parsed.data.type,
      config: channelConfig,
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
      const secrets =
        parsed.data.type === "telegram"
          ? [parsed.data.botToken]
          : [parsed.data.webhookUrl];
      const redacted = redactSecrets(message, secrets);
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
  return (request: Request, server?: UpgradeServer) => handleApiRequest(ctx, request, server);
}
