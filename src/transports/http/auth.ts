import { UserService } from "@/contexts/access/infrastructure/auth/users";
import type { AppContext } from "@/platform/app-context";

import {
  bearerToken,
  parseCookies,
  SESSION_COOKIE,
  type AuthContext,
} from "./http";

export function resolveAuth(ctx: AppContext, request: Request): AuthContext | null {
  const users = new UserService(ctx.db);
  const secret = ctx.getSessionSecret();

  const token = bearerToken(request);
  if (token) {
    const verified = users.verifyApiTokenDetails(token);
    if (verified) {
      return {
        userId: verified.user.id,
        username: verified.user.username,
        authMethod: "token",
        tokenId: verified.token.id,
        scopes: verified.scopes,
      };
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

/** Non-empty token scopes restrict the bearer to explicitly matched HTTP actions. */
export function isScopedAgentToken(auth: AuthContext): boolean {
  return (
    auth.authMethod === "token" &&
    Array.isArray(auth.scopes) &&
    auth.scopes.length > 0
  );
}

export function scopedTokenAllows(
  auth: AuthContext,
  method: string,
  pathname: string,
): boolean {
  if (!isScopedAgentToken(auth) || !auth.scopes) return true;
  if (method !== "POST") return false;
  return auth.scopes.some((scope) => {
    const [resource, action, ...idParts] = scope.split(":");
    const id = idParts.join(":");
    if (!id) return false;
    if (resource === "run" && action === "progress") {
      return pathname === `/api/v1/runs/${id}/progress`;
    }
    if (resource === "run" && action === "approve") {
      return pathname === `/api/v1/runs/${id}/approve`;
    }
    if (resource === "control" && action === "approve") {
      return pathname === `/api/v1/approvals/${id}/approve`;
    }
    return false;
  });
}
