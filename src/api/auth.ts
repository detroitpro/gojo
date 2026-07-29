import { UserService } from "@/auth/users";
import type { AppContext } from "@/app/context";

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

/** Scoped agent tokens may only call POST /runs/:id/progress — never WebSocket. */
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
  return auth.scopes.some((scope) => {
    const match = scope.match(/^run:progress:(.+)$/);
    return (
      method === "POST" &&
      match?.[1] != null &&
      pathname === `/api/v1/runs/${match[1]}/progress`
    );
  });
}
