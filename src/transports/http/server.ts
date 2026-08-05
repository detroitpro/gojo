import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AppContext } from "@/platform/app-context";
import { UserService } from "@/contexts/access/infrastructure/auth/users";
import { checkNetworkStartGates, resolveApiBaseUrl } from "@/platform/config/instance";

import { createRouter } from "./router";
import { createWebSocketHandler } from "./ws/handler";
import { WsHub } from "./ws/hub";

export interface ApiServer {
  port: number;
  hostname: string;
  stop: () => void;
  url: string;
  hub: WsHub;
}

export interface StartServerOptions {
  ctx: AppContext;
  host?: string;
  port?: number;
  writePid?: boolean;
}

export async function startServer(options: StartServerOptions): Promise<ApiServer> {
  const { ctx } = options;
  const hostname = options.host ?? ctx.instance.bindHost;
  const port = options.port ?? ctx.instance.bindPort;

  const effective = { ...ctx.instance, bindHost: hostname, bindPort: port };
  const users = new UserService(ctx.db);
  const gates = checkNetworkStartGates(effective, users.countUsers() > 0);
  if (!gates.ok) {
    throw new Error(`Network start gates failed:\n- ${gates.errors.join("\n- ")}`);
  }
  // Ensures agent callback URL is resolvable before we listen.
  resolveApiBaseUrl(effective);

  const hub = new WsHub(ctx);
  const handler = createRouter(ctx);

  await ctx.scheduler.start();
  ctx.dispatcher.start();

  // Best-effort: reclaim worktrees left by failed/timed-out runs before restart.
  try {
    const { sweepOrphanWorktrees } = await import(
      "@/contexts/operations/infrastructure/worktree-sweep"
    );
    const sweep = await sweepOrphanWorktrees({
      worktreesRoot: ctx.paths.worktrees,
      repos: ctx.repos,
    });
    if (sweep.removed.length > 0) {
      console.error(
        JSON.stringify({
          level: "info",
          component: "worktree-sweep",
          removed: sweep.removed.length,
          keptLive: sweep.keptLive.length,
          errors: sweep.errors.length,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        component: "worktree-sweep",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  const server = Bun.serve({
    hostname,
    port,
    async fetch(request, bunServer) {
      const response = await handler(request, bunServer);
      // Successful WebSocket upgrades return undefined (Bun owns the 101).
      return response ?? undefined!;
    },
    websocket: createWebSocketHandler(ctx, hub),
  });

  if (options.writePid !== false) {
    const pidPath = join(ctx.paths.data, "gojo.pid");
    writeFileSync(pidPath, String(process.pid), "utf8");
  }

  return {
    port: server.port ?? port,
    hostname,
    hub,
    stop() {
      hub.close();
      server.stop();
      const pidPath = join(ctx.paths.data, "gojo.pid");
      if (existsSync(pidPath)) {
        unlinkSync(pidPath);
      }
    },
    url: server.url.toString().replace(/\/$/, ""),
  };
}

export function readPidFile(home: string): number | null {
  const pidPath = join(home, "data", "gojo.pid");
  if (!existsSync(pidPath)) {
    return null;
  }
  const raw = readFileSync(pidPath, "utf8").trim();
  const pid = Number(raw);
  return Number.isFinite(pid) ? pid : null;
}

export async function stopServerByPid(home: string): Promise<boolean> {
  const pid = readPidFile(home);
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { data?: { status?: string } };
    return body.data?.status === "ok";
  } catch {
    return false;
  }
}
