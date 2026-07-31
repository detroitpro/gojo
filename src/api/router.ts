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
import {
  browserOriginFromRequest,
  checkAuthRateLimit,
  corsHeaders,
  csrfFailureMessage,
  csrfOk,
  ipInList,
  originAllowed,
  recordAuthFailure,
  resolveBrowserOriginForSession,
  resolveClient,
  shouldSetSecureCookie,
} from "./network";
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
import {
  normalizePublicBaseUrl,
  resolveApiBaseUrl,
  type CookieSecureMode,
  type InstanceConfig,
} from "@/config/instance";
import { openApiDocument } from "./openapi";
import { listUpcomingSchedules } from "@/scheduler/upcoming";
import { getDashboardOverview } from "@/storage/dashboard-overview";
import { getDashboardImpact } from "@/storage/impact-analytics";
import {
  AGENT_SORT_ALLOWED,
  BACKUP_SORT_ALLOWED,
  getAgentDetail,
  IMPACT_ITEM_SORT_ALLOWED,
  INTEGRATION_LIST_STATUSES,
  INTEGRATION_SORT_ALLOWED,
  listAgentsPage,
  listImpactItemsPage,
  listIntegrationsPage,
  listProjectsPage,
  toProjectDetailRow,
  listRunsPage,
  listSchedulesPage,
  PROJECT_SORT_ALLOWED,
  type IntegrationListStatus,
  QUEUE_SORT_ALLOWED,
  RUN_SORT_ALLOWED,
  SCHEDULE_SORT_ALLOWED,
  TOKEN_SORT_ALLOWED,
} from "@/storage/paged-lists";
import {
  compareSortValues,
  paginateArray,
  parsePageParamsFromUrl,
  parseSortParamsFromUrl,
} from "@shared/pagination";
import { safeParseSchedulingPolicy } from "@shared/scheduling";
import { ApprovalStateSchema } from "@shared/approvals";
import {
  compareWindowToMs,
  parseCompareWindow,
  parseWorkAttention,
  parseWorkDelivery,
  parseWorkExecution,
  parseWorkOutcome,
  parseWorkProvenance,
} from "@shared/work";
import { parseImpactRange } from "@/storage/impact-analytics";
import { createWorkStatusRollup } from "@/storage/work-status-rollup";

/** Minimal Bun.Server surface needed for WebSocket upgrades + client IP. */
export type UpgradeServer = {
  upgrade(
    request: Request,
    options: { data: WsConnectionData; headers?: HeadersInit },
  ): boolean;
  requestIP?(request: Request): { address: string; family: string; port: number } | null;
};

function peerIpFromServer(request: Request, server?: UpgradeServer): string {
  const info = server?.requestIP?.(request);
  if (info?.address) {
    return info.address.replace(/^::ffff:/, "");
  }
  return "127.0.0.1";
}

function instancePublicView(ctx: AppContext, restartRequired = false) {
  let apiBaseUrl: string | null = null;
  try {
    apiBaseUrl = resolveApiBaseUrl(ctx.instance);
  } catch {
    apiBaseUrl = null;
  }
  return {
    bindHost: ctx.instance.bindHost,
    bindPort: ctx.instance.bindPort,
    paused: ctx.isPaused(),
    telemetryEnabled: ctx.instance.telemetryEnabled,
    publicBaseUrl: ctx.instance.publicBaseUrl,
    trustedProxies: ctx.instance.trustedProxies,
    allowedOrigins: ctx.instance.allowedOrigins,
    ipAllowlist: ctx.instance.ipAllowlist,
    cookieSecure: ctx.instance.cookieSecure,
    apiBaseUrl,
    restartRequired,
  };
}

function parseStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === "string")) return null;
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

type RunListItem = {
  id: string;
  projectId: string;
  agentId: string;
  scheduleId: string | null;
  state: string;
  idempotencyKey: string;
  trigger: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  projectName: string | null;
  agentName: string | null;
};

function enrichRun(ctx: AppContext, run: {
  id: string;
  projectId: string;
  agentId: string;
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
  const agent = ctx.repos.agents.findById(run.agentId);
  return {
    ...run,
    projectName: project?.name ?? null,
    agentName: agent?.name ?? null,
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

function isPublicRoute(method: string, pathname: string, hasUsers: boolean): boolean {
  if (method === "OPTIONS" && pathname.startsWith("/api/v1")) {
    return true;
  }
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
  if (
    (method === "GET" || method === "POST") &&
    /^\/api\/v1\/approvals\/[^/]+\/approve-link$/.test(pathname)
  ) {
    return true;
  }
  return false;
}

function withCors(response: Response, request: Request, config: InstanceConfig): Response {
  const extra = corsHeaders(request, config);
  if (!extra) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isAuthExemptMutation(pathname: string): boolean {
  return pathname === "/api/v1/setup" ||
    pathname === "/api/v1/auth/login" ||
    pathname === "/api/v1/auth/logout" ||
    /^\/api\/v1\/approvals\/[^/]+\/approve-link$/.test(pathname) ||
    /^\/api\/v1\/sources\/[^/]+\/events$/.test(pathname);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  const peerIp = peerIpFromServer(request, server);
  const client = resolveClient(request, ctx.instance, peerIp);
  const cookieSecure = shouldSetSecureCookie(ctx.instance.cookieSecure, client.proto);

  // IP allowlist (after proxy resolution). Health stays reachable for probes.
  if (
    pathname.startsWith("/api/v1") &&
    !(pathname === "/api/v1/health" && method === "GET") &&
    ctx.instance.ipAllowlist.length > 0 &&
    !ipInList(client.ip, ctx.instance.ipAllowlist)
  ) {
    return failure("forbidden", "Client IP not allowlisted", 403);
  }

  if (method === "OPTIONS" && pathname.startsWith("/api/v1")) {
    const headers = corsHeaders(request, ctx.instance);
    if (!headers) {
      return failure("forbidden", "Origin not allowed", 403);
    }
    return new Response(null, { status: 204, headers });
  }

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
    const browserOrigin = resolveBrowserOriginForSession(request, ctx.instance);
    if (!browserOrigin || !originAllowed(browserOrigin, ctx.instance, request.url)) {
      const received = browserOriginFromRequest(request) ?? "(none)";
      return failure(
        "forbidden",
        browserOrigin
          ? `Origin not allowed for WebSocket (${browserOrigin})`
          : `WebSocket upgrade requires an allowed Origin or Referer (received ${received})`,
        403,
      );
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
        browserOrigin,
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

    // CSRF for cookie-authenticated mutations (Bearer tokens are exempt).
    const mutationAuth = resolveAuth(ctx, request);
    if (
      isMutating(method) &&
      mutationAuth?.authMethod === "session" &&
      !csrfOk(request, ctx.instance)
    ) {
      return failure("forbidden", csrfFailureMessage(request, ctx.instance), 403);
    }
  }

  const auth = (request as Request & { auth?: AuthContext }).auth;

  const approveLinkMatch = pathname.match(
    /^\/api\/v1\/approvals\/([^/]+)\/approve-link$/,
  );
  if (approveLinkMatch && (method === "GET" || method === "POST")) {
    const approvalId = approveLinkMatch[1] ?? "";
    const token =
      method === "GET"
        ? url.searchParams.get("token")
        : String((await request.formData()).get("token") ?? "");
    const verified = token ? users.verifyApiTokenDetails(token) : null;
    const validScope = verified?.scopes.includes(
      `control:approve:${approvalId}`,
    );
    const approval = ctx.approvals.findById(approvalId);
    if (!verified || !validScope || !approval) {
      return new Response(
        "<!doctype html><title>Invalid approval link</title><h1>Invalid or expired approval link</h1>",
        { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }
    if (method === "POST") {
      const intent = await ctx.approvals.submitIntent({
        projectId: approval.projectId,
        kind: "approve",
        targetType: "approval",
        targetId: approval.id,
        actor: verified.user.username,
        surface: "chat",
        surfaceRef: verified.token.id,
        note: "Approved from single-use notification link",
      });
      users.revokeApiToken(verified.user.id, verified.token.id);
      const applied = intent.state === "applied";
      return new Response(
        `<!doctype html><title>Gojo approval</title><h1>${applied ? "Approval applied" : "Approval not applied"}</h1><p>${escapeHtml(intent.error ?? "You may close this page.")}</p>`,
        {
          status: applied ? 200 : 409,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
    }
    return new Response(
      `<!doctype html><title>Confirm Gojo approval</title><meta name="viewport" content="width=device-width,initial-scale=1"><main><h1>Approve merge?</h1><p>${escapeHtml(approval.reason || approval.subjectId)}</p><form method="post"><input type="hidden" name="token" value="${escapeHtml(token ?? "")}"><button type="submit">Approve</button></form></main>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

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
    if (!checkAuthRateLimit(client.ip)) {
      ctx.repos.audit.create({
        actor: "anonymous",
        action: "auth.rate_limited",
        target: "setup",
        authMethod: "setup",
        sourceIp: client.ip,
        success: false,
      });
      return failure("rate_limited", "Too many setup attempts; try again later", 429);
    }
    const body = await readJsonBody<{ username?: string; password?: string }>(request);
    if (!body?.username || !body.password) {
      recordAuthFailure(client.ip);
      return failure("validation_error", "username and password are required", 400);
    }

    let user;
    try {
      user = await users.createUser(body.username, body.password, "admin");
    } catch (error) {
      recordAuthFailure(client.ip);
      const message = error instanceof Error ? error.message : "Invalid password";
      return failure("validation_error", message, 400);
    }
    ctx.repos.audit.create({
      actor: user.username,
      action: "setup.complete",
      target: `user:${user.id}`,
      authMethod: "setup",
      success: true,
    });

    return success({ user: publicUser(user) }, 201);
  }

  if (method === "GET" && pathname === "/api/v1/auth/me") {
    if (!auth) {
      return failure("unauthorized", "Authentication required", 401);
    }
    const user = users.findById(auth.userId);
    if (!user) {
      return failure("unauthorized", "Authentication required", 401);
    }
    return success({ user: publicUser(user) });
  }

  if (method === "POST" && pathname === "/api/v1/auth/password") {
    if (!auth) {
      return failure("unauthorized", "Authentication required", 401);
    }
    const body = await readJsonBody<{
      currentPassword?: string;
      newPassword?: string;
    }>(request);
    if (!body?.currentPassword || !body.newPassword) {
      return failure(
        "validation_error",
        "currentPassword and newPassword are required",
        400,
      );
    }
    try {
      await users.updatePassword(auth.userId, body.currentPassword, body.newPassword);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Password change failed";
      const status = /current password/i.test(message) ? 401 : 400;
      return failure(
        status === 401 ? "unauthorized" : "validation_error",
        message,
        status,
      );
    }
    ctx.repos.audit.create({
      actor: auth.username,
      action: "auth.password_changed",
      target: `user:${auth.userId}`,
      authMethod: auth.authMethod,
      success: true,
    });
    // Drop the session cookie so browsers must re-login. API tokens stay valid.
    return success({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(cookieSecure) });
  }

  if (method === "POST" && pathname === "/api/v1/auth/login") {
    if (!checkAuthRateLimit(client.ip)) {
      ctx.repos.audit.create({
        actor: "anonymous",
        action: "auth.rate_limited",
        target: "login",
        authMethod: "session",
        sourceIp: client.ip,
        success: false,
      });
      return failure("rate_limited", "Too many login attempts; try again later", 429);
    }
    const body = await readJsonBody<{ username?: string; password?: string }>(request);
    if (!body?.username || !body.password) {
      recordAuthFailure(client.ip);
      return failure("validation_error", "username and password are required", 400);
    }

    const user = await users.verifyCredentials(body.username, body.password);
    if (!user) {
      recordAuthFailure(client.ip);
      return failure("unauthorized", "Invalid credentials", 401);
    }

    const token = users.createSessionToken(user.id, ctx.getSessionSecret());
    return success(
      { user: publicUser(user) },
      200,
      { "Set-Cookie": sessionCookie(token, 7 * 24 * 60 * 60, cookieSecure) },
    );
  }

  if (method === "POST" && pathname === "/api/v1/auth/logout") {
    return success({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(cookieSecure) });
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
        scopes: (() => {
          try {
            const parsed = JSON.parse(token.scopesJson) as unknown;
            return Array.isArray(parsed)
              ? parsed.filter((scope): scope is string => typeof scope === "string")
              : [];
          } catch {
            return [];
          }
        })(),
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
    const body = await readJsonBody<{
      name?: string;
      scopes?: string[];
      expiresAt?: string | null;
    }>(request);
    if (!body?.name) {
      return failure("validation_error", "name is required", 400);
    }

    const scopes = Array.isArray(body.scopes)
      ? body.scopes.filter((scope): scope is string => typeof scope === "string" && scope.length > 0)
      : [];
    if (body.expiresAt && !Number.isFinite(new Date(body.expiresAt).getTime())) {
      return failure("validation_error", "expiresAt must be an ISO date-time", 400);
    }
    const created = users.createApiTokenForUser(auth.userId, body.name, {
      scopes,
      expiresAt: body.expiresAt ?? null,
    });
    return success(
      {
        id: created.record.id,
        name: created.record.name,
        token: created.token,
        scopes,
        createdAt: created.record.createdAt,
        expiresAt: created.record.expiresAt,
      },
      201,
    );
  }

  if (method === "GET" && pathname === "/api/v1/approvals") {
    const page = parsePageParamsFromUrl(url);
    const stateValue = url.searchParams.get("state");
    const parsedState = stateValue ? ApprovalStateSchema.safeParse(stateValue) : null;
    if (parsedState && !parsedState.success) {
      return failure("validation_error", "Invalid approval state", 400);
    }
    const result = ctx.approvals.list({
      ...page,
      ...(url.searchParams.get("projectId")
        ? { projectId: url.searchParams.get("projectId")! }
        : {}),
      ...(url.searchParams.get("subjectType")
        ? { subjectType: url.searchParams.get("subjectType")! }
        : {}),
      ...(parsedState?.success ? { state: parsedState.data } : {}),
    });
    return success({
      approvals: result.items.map((approval) => {
        const workItem = approval.workItemId
          ? ctx.work.items.findById(approval.workItemId)
          : null;
        const run = approval.runId ? ctx.repos.runs.findById(approval.runId) : null;
        const agent = run ? ctx.repos.agents.findById(run.agentId) : null;
        const project = ctx.repos.projects.findById(approval.projectId);
        return {
          ...approval,
          workTitle: workItem?.title ?? null,
          workUrl: workItem?.webUrl ?? null,
          agentName: agent?.name ?? null,
          projectName: project?.name ?? null,
        };
      }),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  }

  const approvalActionMatch = pathname.match(
    /^\/api\/v1\/approvals\/([^/]+)\/(approve|reject|hold)$/,
  );
  const approvalDetailMatch = pathname.match(/^\/api\/v1\/approvals\/([^/]+)$/);
  if (method === "GET" && approvalDetailMatch) {
    const approval = ctx.approvals.findById(approvalDetailMatch[1] ?? "");
    const workItem = approval?.workItemId
      ? ctx.work.items.findById(approval.workItemId)
      : null;
    return approval
      ? success({
          approval: {
            ...approval,
            workTitle: workItem?.title ?? null,
            workUrl: workItem?.webUrl ?? null,
          },
        })
      : failure("not_found", "Approval not found", 404);
  }
  if (method === "POST" && approvalActionMatch) {
    if (!auth) return failure("unauthorized", "Authentication required", 401);
    const approvalId = approvalActionMatch[1] ?? "";
    const approval = ctx.approvals.findById(approvalId);
    if (!approval) return failure("not_found", "Approval not found", 404);
    const body = await readJsonBody<{ note?: string; surfaceRef?: string }>(request);
    const action = approvalActionMatch[2] as "approve" | "reject" | "hold";
    const intent = await ctx.approvals.submitIntent({
      projectId: approval.projectId,
      kind: action,
      targetType: "approval",
      targetId: approval.id,
      actor: auth.username,
      surface: "api",
      surfaceRef: body?.surfaceRef ?? auth.tokenId ?? null,
      note: body?.note ?? null,
    });
    if (intent.state === "rejected") {
      return failure("conflict", intent.error ?? "Approval intent rejected", 409);
    }
    if (
      action === "approve" &&
      auth.authMethod === "token" &&
      auth.tokenId &&
      auth.scopes?.includes(`control:approve:${approval.id}`)
    ) {
      users.revokeApiToken(auth.userId, auth.tokenId);
    }
    return success({
      intent,
      approval: ctx.approvals.findById(approval.id),
    });
  }

  if (method === "POST" && pathname === "/api/v1/control/intents") {
    if (!auth) return failure("unauthorized", "Authentication required", 401);
    const body = await readJsonBody<{
      projectId?: string;
      kind?: "approve" | "reject" | "hold" | "claim" | "cancel" | "retry";
      targetType?: string;
      targetId?: string;
      note?: string;
      surfaceRef?: string;
    }>(request);
    if (!body?.projectId || !body.kind || !body.targetType || !body.targetId) {
      return failure(
        "validation_error",
        "projectId, kind, targetType, and targetId are required",
        400,
      );
    }
    const intent = await ctx.approvals.submitIntent({
      projectId: body.projectId,
      kind: body.kind,
      targetType: body.targetType,
      targetId: body.targetId,
      actor: auth.username,
      surface: "api",
      surfaceRef: body.surfaceRef ?? null,
      note: body.note ?? null,
    });
    return success({ intent }, intent.state === "applied" ? 201 : 409);
  }

  const workDiffMatch = pathname.match(/^\/api\/v1\/work\/([^/]+)\/diff$/);
  if (method === "GET" && workDiffMatch) {
    const workItem = ctx.work.items.findById(workDiffMatch[1] ?? "");
    if (!workItem) return failure("not_found", "Work item not found", 404);
    try {
      return success({
        workItemId: workItem.id,
        diff: await ctx.mergeService.getDiff(workItem.projectId, workItem.id),
      });
    } catch (error) {
      return failure(
        "validation_error",
        error instanceof Error ? error.message : String(error),
        400,
      );
    }
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
            "agents",
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

  if (method === "GET" && pathname === "/api/v1/adapters") {
    const adapters = listAdapters();
    const detected = await Promise.all(
      adapters.map(async (adapter) => ({
        name: adapter.name,
        ...(await adapter.detect()),
      })),
    );
    return success({ adapters: detected });
  }

  const adapterTestMatch = pathname.match(/^\/api\/v1\/adapters\/([^/]+)\/test$/);
  if (method === "POST" && adapterTestMatch) {
    const name = decodeURIComponent(adapterTestMatch[1] ?? "");
    const adapter = listAdapters().find((item) => item.name === name);
    if (!adapter) {
      return failure("not_found", "Adapter not found", 404);
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

  if (method === "GET" && pathname === "/api/v1/agents") {
    const page = parsePageParamsFromUrl(url);
    const sort = parseSortParamsFromUrl(url, {
      allowed: AGENT_SORT_ALLOWED,
      defaultSort: "name",
      defaultOrder: "asc",
    });
    const result = listAgentsPage(ctx.db, {
      ...page,
      ...sort,
      projectId: url.searchParams.get("projectId"),
      enabled: parseEnabledParam(url.searchParams.get("enabled")),
      q: url.searchParams.get("q"),
    });
    return success({
      agents: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  }

  if (method === "POST" && pathname === "/api/v1/agents") {
    const body = await readJsonBody<{
      projectId?: string;
      name?: string;
      prompt?: string;
      description?: string;
      profileId?: string | null;
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

    const agent = ctx.repos.agents.create({
      projectId: body.projectId,
      name: body.name,
      prompt: body.prompt,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.profileId !== undefined ? { profileId: body.profileId } : {}),
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
      projectId: agent.projectId,
      type: "agent.created",
      entityKind: "agent",
      entityId: agent.id,
      topics: ["dashboard", "overview", "projects", "agents"],
    });

    return success({ agent }, 201);
  }

  const agentGetMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
  if (method === "GET" && agentGetMatch) {
    const agentId = agentGetMatch[1] ?? "";
    const agent = getAgentDetail(ctx.db, agentId);
    if (!agent) {
      return failure("not_found", "Agent not found", 404);
    }
    return success({ agent });
  }

  const agentRunMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/run$/);
  if (method === "POST" && agentRunMatch) {
    const agentId = agentRunMatch[1] ?? "";
    const agent = ctx.repos.agents.findById(agentId);
    if (!agent) {
      return failure("not_found", "Agent not found", 404);
    }

    const run = await ctx.coordinator.enqueueRun({
      projectId: agent.projectId,
      agentId: agent.id,
      trigger: "api",
    });
    ctx.dispatcher.kick();

    return success({ run }, 202);
  }

  const agentActionMatch = pathname.match(/^\/api\/v1\/agents\/([^/]+)\/(enable|disable)$/);
  if (method === "POST" && agentActionMatch) {
    const agentId = agentActionMatch[1] ?? "";
    const action = agentActionMatch[2];
    const agent = ctx.repos.agents.findById(agentId);
    if (!agent) {
      return failure("not_found", "Agent not found", 404);
    }

    const updated = ctx.repos.agents.update(agentId, { enabled: action === "enable" });
    ctx.platformEvents.append({
      projectId: agent.projectId,
      type: "agent.updated",
      entityKind: "agent",
      entityId: agent.id,
      topics: ["dashboard", "overview", "projects", "agents"],
      data: { enabled: action === "enable" },
    });
    return success({ agent: updated });
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
      agentId: url.searchParams.get("agentId"),
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
    const scheduleProjectId = ctx.repos.agents.findById(schedule.agentId)?.projectId ?? null;

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
      agentId: url.searchParams.get("agentId"),
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
      approval: ctx.approvals.findByRun(runId),
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
      agentId: run.agentId,
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
      const agent = ctx.repos.agents.findById(run.agentId);
      return {
        runId: run.id,
        projectId: run.projectId,
        projectName: project?.name ?? null,
        agentId: run.agentId,
        agentName: agent?.name ?? null,
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
        const agent = ctx.repos.agents.findById(run.agentId);
        return {
          runId: run.id,
          projectId: run.projectId,
          projectName: project?.name ?? null,
          agentId: run.agentId,
          agentName: agent?.name ?? null,
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
    const agents = ctx.repos.agents.count();
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
      agents,
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
    return success(instancePublicView(ctx));
  }

  if (method === "PATCH" && pathname === "/api/v1/instance") {
    const body = await readJsonBody<{
      telemetryEnabled?: boolean;
      bindHost?: string;
      bindPort?: number;
      publicBaseUrl?: string | null;
      trustedProxies?: string[];
      allowedOrigins?: string[];
      ipAllowlist?: string[];
      cookieSecure?: CookieSecureMode;
    }>(request);
    if (!body || typeof body !== "object") {
      return failure("validation_error", "JSON body is required", 400);
    }

    const keys = [
      "telemetryEnabled",
      "bindHost",
      "bindPort",
      "publicBaseUrl",
      "trustedProxies",
      "allowedOrigins",
      "ipAllowlist",
      "cookieSecure",
    ] as const;
    if (!keys.some((key) => key in body)) {
      return failure(
        "validation_error",
        "At least one of telemetryEnabled, bindHost, bindPort, publicBaseUrl, trustedProxies, allowedOrigins, ipAllowlist, cookieSecure is required",
        400,
      );
    }

    let restartRequired = false;
    const previous = { ...ctx.instance };

    if (body.telemetryEnabled !== undefined) {
      if (typeof body.telemetryEnabled !== "boolean") {
        return failure("validation_error", "telemetryEnabled must be a boolean", 400);
      }
      ctx.setTelemetryEnabled(body.telemetryEnabled);
    }

    if (body.bindHost !== undefined) {
      if (typeof body.bindHost !== "string" || !body.bindHost.trim()) {
        return failure("validation_error", "bindHost must be a non-empty string", 400);
      }
      ctx.instance.bindHost = body.bindHost.trim();
      restartRequired = true;
    }
    if (body.bindPort !== undefined) {
      if (typeof body.bindPort !== "number" || !Number.isInteger(body.bindPort)) {
        return failure("validation_error", "bindPort must be an integer", 400);
      }
      if (body.bindPort < 1 || body.bindPort > 65535) {
        return failure("validation_error", "bindPort must be between 1 and 65535", 400);
      }
      ctx.instance.bindPort = body.bindPort;
      restartRequired = true;
    }
    if (body.publicBaseUrl !== undefined) {
      try {
        ctx.instance.publicBaseUrl =
          body.publicBaseUrl === null ? null : normalizePublicBaseUrl(body.publicBaseUrl);
      } catch (error) {
        return failure(
          "validation_error",
          error instanceof Error ? error.message : "Invalid publicBaseUrl",
          400,
        );
      }
      restartRequired = true;
    }
    if (body.trustedProxies !== undefined) {
      const list = parseStringList(body.trustedProxies);
      if (!list) {
        return failure("validation_error", "trustedProxies must be an array of strings", 400);
      }
      ctx.instance.trustedProxies = list;
      restartRequired = true;
    }
    if (body.allowedOrigins !== undefined) {
      const list = parseStringList(body.allowedOrigins);
      if (!list) {
        return failure("validation_error", "allowedOrigins must be an array of strings", 400);
      }
      ctx.instance.allowedOrigins = list;
      restartRequired = true;
    }
    if (body.ipAllowlist !== undefined) {
      const list = parseStringList(body.ipAllowlist);
      if (!list) {
        return failure("validation_error", "ipAllowlist must be an array of strings", 400);
      }
      ctx.instance.ipAllowlist = list;
      restartRequired = true;
    }
    if (body.cookieSecure !== undefined) {
      if (
        body.cookieSecure !== "auto" &&
        body.cookieSecure !== "always" &&
        body.cookieSecure !== "never"
      ) {
        return failure(
          "validation_error",
          "cookieSecure must be auto, always, or never",
          400,
        );
      }
      ctx.instance.cookieSecure = body.cookieSecure;
      restartRequired = true;
    }

    if (restartRequired) {
      ctx.saveInstanceConfig();
    }

    ctx.platformEvents.append({
      type: "instance.updated",
      entityKind: "instance",
      entityId: "instance",
      topics: ["dashboard"],
      data: {
        telemetryEnabled: ctx.instance.telemetryEnabled,
        restartRequired,
        previousBindHost: previous.bindHost,
        bindHost: ctx.instance.bindHost,
      },
    });
    return success(instancePublicView(ctx, restartRequired));
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
      agent: "notification-test",
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
  return async (request: Request, server?: UpgradeServer) => {
    const response = await handleApiRequest(ctx, request, server);
    if (response === undefined) {
      return undefined;
    }
    return withCors(response, request, ctx.instance);
  };
}
