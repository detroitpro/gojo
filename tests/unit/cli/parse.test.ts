import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getHome, getOutputFormat, parseArgv } from "@/cli/parse";

describe("cli/parse", () => {
  test("parses command, flags, and positional args", () => {
    const parsed = parseArgv([
      "--home",
      "/tmp/gojo",
      "--output",
      "json",
      "project",
      "add",
      "demo",
      "/repos/demo",
      "--branch",
      "main",
    ]);

    expect(parsed.command).toEqual(["project", "add"]);
    expect(parsed.positional).toEqual(["demo", "/repos/demo"]);
    expect(getHome(parsed)).toBe("/tmp/gojo");
    expect(getOutputFormat(parsed)).toBe("json");
    expect(parsed.flags["branch"]).toBe("main");
  });

  test("supports boolean and equals-style flags", () => {
    const parsed = parseArgv(["server", "start", "--daemon", "--foreground=false"]);
    expect(parsed.command).toEqual(["server", "start"]);
    expect(parsed.flags["daemon"]).toBe(true);
    expect(parsed.flags["foreground"]).toBe("false");
  });

  test("supports short help flag", () => {
    const parsed = parseArgv(["-h"]);
    expect(parsed.flags["help"]).toBe(true);
  });

  test("passes through args after --", () => {
    const parsed = parseArgv(["task", "run", "--", "extra"]);
    expect(parsed.positional).toEqual(["extra"]);
  });
});

describe("cli help", () => {
  test("documents gojo service status", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "--help"], {
      cwd: join(import.meta.dir, "../../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    expect(text).toContain("service install|uninstall|start|stop|restart|status|logs");
  });
});

