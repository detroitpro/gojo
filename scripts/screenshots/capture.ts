/**
 * Capture ops-console screenshots for the Astro site.
 *
 * Prerequisites:
 *   - gojo UI reachable (default http://127.0.0.1:7430)
 *   - Instance has projects / runs / schedules worth showing
 *   - bunx playwright install chromium  (once)
 *
 * Usage:
 *   bun run screenshots:ui
 *   GOJO_BASE_URL=http://127.0.0.1:5173 bun run screenshots:ui
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Page } from "playwright";

import { mintSessionToken } from "./mint-session";
import { SESSION_COOKIE } from "../../src/api/http";

const ROOT = join(import.meta.dir, "../..");
const DEFAULT_BASE = "http://127.0.0.1:7430";
const VIEWPORT = { width: 1440, height: 900 };

const SHOTS: { file: string; path: string }[] = [
  { file: "ui-dashboard.png", path: "/" },
  { file: "ui-projects.png", path: "/projects" },
  { file: "ui-agents.png", path: "/agents" },
  { file: "ui-adapters.png", path: "/adapters" },
  { file: "ui-runs.png", path: "/runs" },
  { file: "ui-schedules.png", path: "/schedules" },
  { file: "ui-integrations.png", path: "/integrations?status=merged" },
  { file: "ui-impact.png", path: "/impact" },
];

async function waitForShell(page: Page) {
  await page.waitForSelector(".page-header h1", { timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Let font/CSS settle and avoid mid-fetch empty tables.
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function main() {
  const baseUrl = (process.env["GOJO_BASE_URL"] ?? DEFAULT_BASE).replace(/\/$/, "");
  const outDir = process.env["OUT_DIR"] ?? join(ROOT, "site/public/images");
  const token = process.env["GOJO_SESSION"] ?? mintSessionToken();
  mkdirSync(outDir, { recursive: true });

  const origin = new URL(baseUrl);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    baseURL: baseUrl,
  });
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: origin.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();

  for (const shot of SHOTS) {
    const dest = join(outDir, shot.file);
    process.stdout.write(`capture ${shot.path} → ${dest}\n`);
    await page.goto(shot.path, { waitUntil: "domcontentloaded" });
    await waitForShell(page);
    await page.screenshot({ path: dest, type: "png", fullPage: false });
  }

  process.stdout.write("capture /runs → first run detail\n");
  await page.goto("/runs", { waitUntil: "domcontentloaded" });
  await waitForShell(page);
  const detailHref = await page
    .locator('table.data tbody a[href^="/runs/"]')
    .first()
    .getAttribute("href");
  if (!detailHref) {
    await browser.close();
    throw new Error("No run detail links on /runs — enqueue a run before capturing");
  }
  await page.goto(detailHref, { waitUntil: "domcontentloaded" });
  await waitForShell(page);
  const detailDest = join(outDir, "ui-run-detail.png");
  await page.screenshot({ path: detailDest, type: "png", fullPage: false });
  process.stdout.write(`wrote ${detailDest}\n`);

  await browser.close();
  process.stdout.write(`done → ${outDir}\n`);
}

await main();
