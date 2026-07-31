import type { AppContext } from "@/app/context";
import type { ClientReqFrame, ServerResFrame } from "@shared/ws";

import type { AuthContext } from "../http";
import { handleApiRequest } from "../router";
import type { WsConnectionData } from "./types";

export type { WsConnectionData };

/**
 * Execute an RPC frame by synthesizing an HTTP Request and reusing handleApiRequest.
 */
export async function handleRpcFrame(
  ctx: AppContext,
  data: WsConnectionData,
  frame: ClientReqFrame,
): Promise<ServerResFrame> {
  const path = frame.path.startsWith("/") ? frame.path : `/${frame.path}`;
  if (!path.startsWith("/api/v1/")) {
    return {
      t: "res",
      id: frame.id,
      ok: false,
      status: 400,
      error: { code: "bad_request", message: "RPC path must start with /api/v1/" },
    };
  }

  const headers = new Headers(data.headers);
  headers.set("Origin", data.browserOrigin);
  if (frame.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const init: RequestInit = {
    method: frame.method,
    headers,
  };
  if (frame.body !== undefined && frame.method !== "GET") {
    init.body = JSON.stringify(frame.body);
  }

  const url = new URL(path, data.origin);
  const request = new Request(url, init);
  (request as Request & { auth?: AuthContext }).auth = data.auth;

  try {
    const response = await handleApiRequest(ctx, request);
    if (!response) {
      return {
        t: "res",
        id: frame.id,
        ok: false,
        status: 502,
        error: { code: "internal", message: "Empty RPC response" },
      };
    }
    const status = response.status;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        t: "res",
        id: frame.id,
        ok: false,
        status: 502,
        error: { code: "internal", message: "Non-JSON RPC response" },
      };
    }

    if (status >= 200 && status < 300) {
      const dataBody =
        body && typeof body === "object" && "data" in body
          ? (body as { data: unknown }).data
          : body;
      return { t: "res", id: frame.id, ok: true, data: dataBody };
    }

    const error =
      body && typeof body === "object" && "error" in body
        ? (body as { error: { code?: string; message?: string } }).error
        : null;
    return {
      t: "res",
      id: frame.id,
      ok: false,
      status,
      error: {
        code: error?.code ?? "unknown",
        message: error?.message ?? `HTTP ${status}`,
      },
    };
  } catch (caught) {
    return {
      t: "res",
      id: frame.id,
      ok: false,
      status: 500,
      error: {
        code: "internal",
        message: caught instanceof Error ? caught.message : String(caught),
      },
    };
  }
}
