import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  findCommandHelp,
  findGroup,
  suggestCommands,
} from "@/transports/cli/help";
import { colorEnabled, style } from "@/transports/cli/style";
import { formatTable } from "@/transports/cli/table";

const repoRoot = join(import.meta.dir, "../../../..");

describe("cli/help registry", () => {
  test("resolves group and command help", () => {
    expect(findGroup("auth")?.summary).toMatch(/password/i);
    expect(findCommandHelp("auth", "password")?.usage).toContain("auth password");
    expect(findCommandHelp("setup")?.notes?.some((n) => /create-once/i.test(n))).toBe(true);
    expect(findCommandHelp("work-status", "rebuild")).not.toBeNull();
  });

  test("suggests nearby commands", () => {
    const suggestions = suggestCommands("aut");
    expect(suggestions.some((s) => s.includes("auth"))).toBe(true);
  });

  test("top-level help lists auth and work-status", async () => {
    const proc = Bun.spawn(["bun", "run", "src/transports/cli/index.ts", "--help"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    expect(text).toContain("auth");
    expect(text).toContain("work-status");
    expect(text).toContain("setup");
    expect(text).not.toMatch(/\u001b\[/);
  });

  test("setup already completed points at auth password", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "gojo-cli-setup-"));
    try {
      const first = Bun.spawn(
        [
          "bun",
          "run",
          "src/transports/cli/index.ts",
          "--home",
          dir,
          "--output",
          "json",
          "setup",
          "--username",
          "admin",
          "--password",
          "password-here",
        ],
        { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
      );
      await first.exited;
      expect(first.exitCode).toBe(0);

      const second = Bun.spawn(
        [
          "bun",
          "run",
          "src/transports/cli/index.ts",
          "--home",
          dir,
          "setup",
          "--username",
          "other",
          "--password",
          "password-here",
        ],
        { cwd: repoRoot, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } },
      );
      const err = await new Response(second.stderr).text();
      await second.exited;
      expect(second.exitCode).toBe(3);
      expect(err).toMatch(/already completed/i);
      expect(err).toMatch(/gojo auth password/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cli/style and table", () => {
  test("NO_COLOR disables ANSI", () => {
    const prev = process.env["NO_COLOR"];
    process.env["NO_COLOR"] = "1";
    try {
      expect(colorEnabled()).toBe(false);
      expect(style.red("x")).toBe("x");
    } finally {
      if (prev === undefined) {
        delete process.env["NO_COLOR"];
      } else {
        process.env["NO_COLOR"] = prev;
      }
    }
  });

  test("formatTable renders headers and rows", () => {
    const text = formatTable(
      [{ name: "a", on: "yes" }],
      [
        { key: "name", header: "NAME", value: (r) => r.name },
        { key: "on", header: "ON", value: (r) => r.on },
      ],
    );
    expect(text).toContain("NAME");
    expect(text).toContain("a");
  });
});
