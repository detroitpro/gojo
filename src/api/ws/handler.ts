import type { ServerWebSocket } from "bun";

import type { AppContext } from "@/app/context";
import { WS_PROTOCOL_VERSION, type ServerFrame } from "@shared/ws";

import { parseClientFrame } from "./schema";
import { handleRpcFrame } from "./rpc";
import { WsHub, type WsSocket } from "./hub";
import type { WsConnectionData } from "./types";

export type GojoWsData = WsConnectionData;

function send(ws: ServerWebSocket<GojoWsData>, frame: ServerFrame): void {
  ws.send(JSON.stringify(frame));
}

export function createWebSocketHandler(ctx: AppContext, hub: WsHub) {
  return {
    data: {} as GojoWsData,
    idleTimeout: 120,
    open(ws: ServerWebSocket<GojoWsData>) {
      hub.attach(ws as unknown as WsSocket);
      send(ws, {
        t: "hello",
        user: { id: ws.data.auth.userId, username: ws.data.auth.username },
        version: WS_PROTOCOL_VERSION,
      });
    },
    async message(ws: ServerWebSocket<GojoWsData>, message: string | Buffer) {
      const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
      const parsed = parseClientFrame(raw);
      if (!parsed.ok) {
        send(ws, {
          t: "res",
          id: 0,
          ok: false,
          status: 400,
          error: { code: "bad_request", message: parsed.error },
        });
        return;
      }

      const frame = parsed.frame;
      if (frame.t === "req") {
        const result = await handleRpcFrame(ctx, ws.data, frame);
        send(ws, result);
        return;
      }

      if (frame.t === "sub") {
        if (frame.channel === "platform") {
          hub.subscribePlatform(ws as unknown as WsSocket, {
            t: "sub",
            id: frame.id,
            channel: "platform",
            ...(frame.topics ? { topics: frame.topics } : {}),
            ...(frame.projectId !== undefined ? { projectId: frame.projectId } : {}),
            ...(frame.after !== undefined ? { after: frame.after } : {}),
          });
          send(ws, { t: "res", id: frame.id, ok: true, data: { subscribed: true } });
          return;
        }
        const result = hub.subscribeRun(ws as unknown as WsSocket, {
          t: "sub",
          id: frame.id,
          channel: "run",
          runId: frame.runId,
          ...(frame.after ? { after: frame.after } : {}),
        });
        if (!result.ok) {
          send(ws, {
            t: "res",
            id: frame.id,
            ok: false,
            status: result.status,
            error: { code: result.status === 404 ? "not_found" : "bad_request", message: result.error },
          });
          return;
        }
        send(ws, { t: "res", id: frame.id, ok: true, data: { subscribed: true } });
        return;
      }

      if (frame.t === "unsub") {
        const removed = hub.unsubscribe(frame.id);
        send(ws, {
          t: "res",
          id: frame.id,
          ok: true,
          data: { unsubscribed: removed },
        });
      }
    },
    close(ws: ServerWebSocket<GojoWsData>) {
      hub.detach(ws as unknown as WsSocket);
    },
  };
}
