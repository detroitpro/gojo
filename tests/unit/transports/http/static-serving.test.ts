import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppContext } from "@/platform/app-context";
import { createRouter } from "@/transports/http/router";

describe("http static serving", () => {
  let homeDir: string | null = null;
  let webDist: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let prevWebDist: string | undefined;

  afterEach(async () => {
    server?.stop();
    server = null;
    await ctx?.dispose();
    ctx = null;
    if (prevWebDist === undefined) delete process.env["GOJO_WEB_DIST"];
    else process.env["GOJO_WEB_DIST"] = prevWebDist;
    prevWebDist = undefined;
    if (webDist) {
      rmSync(webDist, { recursive: true, force: true });
      webDist = null;
    }
    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
      homeDir = null;
    }
  });

  async function bootWithWebDist(files: Record<string, string>): Promise<string> {
    homeDir = mkdtempSync(`${tmpdir()}/gojo-static-home-`);
    webDist = mkdtempSync(`${tmpdir()}/gojo-static-web-`);
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(webDist, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, body);
    }
    prevWebDist = process.env["GOJO_WEB_DIST"];
    process.env["GOJO_WEB_DIST"] = webDist;

    ctx = await createAppContext(homeDir);
    const handler = createRouter(ctx);
    server = Bun.serve({
      port: 0,
      fetch: async (req, bunServer) => (await handler(req, bunServer)) ?? undefined!,
    });
    return server.url.toString().replace(/\/$/, "");
  }

  test("serves favicon.svg and 404s missing favicon.ico without SPA HTML", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>';
    const index = "<!doctype html><title>gojo</title><body>app</body>";
    const baseUrl = await bootWithWebDist({
      "index.html": index,
      "favicon.svg": svg,
    });

    const icon = await fetch(`${baseUrl}/favicon.svg`);
    expect(icon.status).toBe(200);
    const iconType = icon.headers.get("Content-Type") ?? "";
    expect(iconType.includes("svg") || iconType.includes("xml")).toBe(true);
    expect(await icon.text()).toContain("<svg");

    const missingIco = await fetch(`${baseUrl}/favicon.ico`);
    expect(missingIco.status).toBe(404);
    const icoBody = await missingIco.text();
    expect(icoBody).not.toContain("<!doctype html>");
    expect(icoBody).not.toContain("gojo");
  });

  test("unknown client routes still fall back to SPA index.html", async () => {
    const index = "<!doctype html><title>gojo-spa</title><body>shell</body>";
    const baseUrl = await bootWithWebDist({ "index.html": index });

    const spa = await fetch(`${baseUrl}/projects/abc/history`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("gojo-spa");
  });

  test("missing hashed asset with a static extension is 404 not HTML", async () => {
    const index = "<!doctype html><title>gojo</title>";
    const baseUrl = await bootWithWebDist({ "index.html": index });

    const asset = await fetch(`${baseUrl}/assets/missing-chunk.js`);
    expect(asset.status).toBe(404);
    expect(await asset.text()).not.toContain("<!doctype html>");
  });
});
