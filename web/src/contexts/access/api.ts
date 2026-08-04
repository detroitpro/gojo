import type { ApiTokenInfo, CreatedApiToken, User } from "./types";
import { ApiError } from "@/infrastructure/api-error";
import { API_BASE, httpRequest, request } from "@/infrastructure/http";
import { buildListQuery, type ListQuery, type PaginatedResult } from "@/kernel/pagination";
import { gojoSocket } from "@/infrastructure/ws-client";

export type { ListQuery, PaginatedResult };

/** undefined = unknown (not probed yet); null = logged out; User = authenticated. */
let sessionCache: User | null | undefined;

function rememberSession(user: User | null): void {
  sessionCache = user;
}

export function clearSessionCache(): void {
  sessionCache = undefined;
}

export async function probeSetupNeeded(): Promise<boolean> {
  const response = await fetch(`${API_BASE}/setup`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (response.status === 403) {
    return false;
  }
  if (response.status === 400) {
    return true;
  }
  return false;
}

export async function setup(username: string, password: string): Promise<User> {
  const { data } = await httpRequest<{ user: User }>("/setup", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  rememberSession(data.user);
  gojoSocket.connect();
  return data.user;
}

export async function login(username: string, password: string): Promise<User> {
  const { data } = await httpRequest<{ user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  rememberSession(data.user);
  gojoSocket.connect();
  return data.user;
}

export async function logout(): Promise<void> {
  gojoSocket.disconnect();
  clearSessionCache();
  try {
    await httpRequest<{ ok: boolean }>("/auth/logout", { method: "POST" });
  } finally {
    rememberSession(null);
  }
}

export async function getMe(): Promise<User> {
  const { data } = await request<{ user: User }>("/auth/me");
  rememberSession(data.user);
  return data.user;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request<{ ok: boolean }>("/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  gojoSocket.disconnect();
  rememberSession(null);
}

export async function listApiTokens(query: ListQuery = {}): Promise<PaginatedResult<ApiTokenInfo>> {
  const { data } = await request<{
    tokens: ApiTokenInfo[];
    total: number;
    limit: number;
    offset: number;
  }>(`/auth/tokens${buildListQuery(query)}`);
  return {
    items: data.tokens,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function createApiToken(name: string): Promise<CreatedApiToken> {
  const { data } = await request<CreatedApiToken>("/auth/tokens", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return data;
}

export async function revokeApiToken(id: string): Promise<void> {
  await request<{ revoked: boolean }>(`/auth/tokens/${id}`, { method: "DELETE" });
}

/**
 * Auth gate for the router. Probes GET /instance once, then trusts the cache
 * until login/logout/reauth. Live session loss is handled by the WebSocket
 * 401 → onReauth path, not by re-hitting /instance on every navigation.
 */
export async function checkSession(options?: { force?: boolean }): Promise<User | null> {
  if (!options?.force && sessionCache !== undefined) {
    if (sessionCache) gojoSocket.connect();
    return sessionCache;
  }
  try {
    const { data } = await httpRequest<{ user: User }>("/auth/me");
    gojoSocket.connect();
    rememberSession(data.user);
    return data.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      gojoSocket.disconnect();
      rememberSession(null);
      return null;
    }
    throw error;
  }
}

gojoSocket.onReauth(() => {
  rememberSession(null);
  gojoSocket.disconnect();
});
