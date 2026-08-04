import type { WsHttpMethod } from "@gojo/contracts/types";

import { ApiError } from "./api-error";
import { gojoSocket } from "./ws-client";

export const API_BASE = "/api/v1";

interface ApiSuccess<T> {
  data: T;
}

interface ApiFailure {
  error: {
    code: string;
    message: string;
  };
}

/** Always-HTTP helper for pre-auth and health probes. */
export async function httpRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; response: Response }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  const body = (await response.json()) as ApiSuccess<T> | ApiFailure;

  if (!response.ok) {
    const err = "error" in body ? body.error : { code: "unknown", message: response.statusText };
    throw new ApiError(err.code, err.message, response.status);
  }

  return { data: (body as ApiSuccess<T>).data, response };
}

export function syntheticResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Browser RPC: prefer the shared WebSocket, fall back to fetch when the socket
 * is down so live-refresh polling and degraded mode still work.
 */
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; response: Response }> {
  const method = ((init.method ?? "GET").toUpperCase()) as WsHttpMethod;
  let body: unknown;
  if (typeof init.body === "string" && init.body.length > 0) {
    try {
      body = JSON.parse(init.body) as unknown;
    } catch {
      body = init.body;
    }
  }

  if (gojoSocket.connected) {
    try {
      const result = await gojoSocket.request(method, path, body);
      if (result.ok) {
        return {
          data: result.data as T,
          response: syntheticResponse(200, { data: result.data }),
        };
      }
      throw new ApiError(result.error.code, result.error.message, result.status);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Fall through to HTTP on transport errors.
    }
  }

  return httpRequest<T>(path, init);
}
