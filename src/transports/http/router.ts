import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { resolveWebDistDir } from "./web-dist";

import { UserService } from "@/contexts/access/infrastructure/auth/users";
import type { AppContext } from "@/platform/app-context";
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
import {
  getUseCaseRegistry,
  tryDispatchRegisteredRoute,
} from "@/platform";
import type { InstanceConfig } from "@/platform/config/instance";
import { buildOpenApiDocument } from "./openapi";

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

  // Registry strangler: migrated HTTP routes resolve here first.
  // Unmatched paths fall through to the legacy if-chain below.
  // @removal(when: all /api/v1 routes registered): delete the legacy if-chain — R2
  // Per-route leftovers: delete each handler when its use case is registered — R1
  {
    const registered = await tryDispatchRegisteredRoute(
      getUseCaseRegistry(),
      ctx,
      request,
      method,
      pathname,
    );
    if (registered) {
      return registered;
    }
  }

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

  if (method === "GET" && pathname === "/api/v1/openapi.json") {
    return success(buildOpenApiDocument());
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

  // GET /api/v1/auth/me is served by access.me.get (registry).

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

  // JSON API business routes are served by the use-case registry (see src/contexts/*/use-cases.ts).
  // Transport leftovers below: Set-Cookie auth (above), HTML approve-link (above), static.

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
