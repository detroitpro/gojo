import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AppContext } from "@/app/context";

import { createRouter } from "./router";

export interface ApiServer {
  port: number;
  hostname: string;
  stop: () => void;
  url: string;
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
  const handler = createRouter(ctx);

  await ctx.scheduler.start();
  ctx.dispatcher.start();

  const server = Bun.serve({
    hostname,
    port,
    fetch: handler,
    // SSE run event streams stay open for minutes; Bun's default 10s idle
    // timeout otherwise closes them ("request timed out" → Vite socket hang up).
    idleTimeout: 0,
  });

  if (options.writePid !== false) {
    const pidPath = join(ctx.paths.data, "gojo.pid");
    writeFileSync(pidPath, String(process.pid), "utf8");
  }

  return {
    port: server.port ?? port,
    hostname,
    stop() {
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
