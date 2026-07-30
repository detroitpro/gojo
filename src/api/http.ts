import type { ApiErrorCode } from "@shared/api";

export const SESSION_COOKIE = "gojo_session";

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiFailure {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type AuthContext = {
  userId: string;
  username: string;
  authMethod: "session" | "token";
  tokenId?: string;
  scopes?: string[];
};

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  const merged = new Headers(headers);
  if (!merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), { status, headers: merged });
}

export function success<T>(data: T, status = 200, headers?: HeadersInit): Response {
  return jsonResponse({ data } satisfies ApiSuccess<T>, status, headers);
}

export function failure(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  const body: ApiFailure = {
    error: details ? { code, message, details } : { code, message },
  };
  return jsonResponse(body, status);
}

export async function readJsonBody<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) {
      continue;
    }
    cookies[rawKey] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

export function sessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure = false,
): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearSessionCookie(secure = false): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
