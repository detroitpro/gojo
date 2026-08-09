import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";

import {
  findCommandHelp,
  findGroup,
  printCommandHelp,
  printGroupHelp,
  printOverviewHelp,
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

  test("findCommandHelp returns null for missing group or subcommand", () => {
    expect(findCommandHelp()).toBeNull();
    expect(findCommandHelp("not-a-group")).toBeNull();
    expect(findCommandHelp("auth", "not-a-sub")).toBeNull();
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

describe("cli/help printers", () => {
  const spies: Array<ReturnType<typeof spyOn>> = [];

  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
    spies.length = 0;
  });

  function captureStdout(): string[] {
    const lines: string[] = [];
    spies.push(
      spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      }),
    );
    return lines;
  }

  test("print helpers render overview, group, and command sections", () => {
    const prev = process.env["NO_COLOR"];
    process.env["NO_COLOR"] = "1";
    try {
      const overview = captureStdout();
      printOverviewHelp();
      expect(overview.some((line) => /gojo/.test(line))).toBe(true);
      expect(overview.some((line) => /auth/.test(line))).toBe(true);

      const group = findGroup("instance");
      expect(group).not.toBeNull();
      const groupLines = captureStdout();
      printGroupHelp(group!);
      expect(groupLines.some((line) => /\bset\b/.test(line) && /network fields/i.test(line))).toBe(
        true,
      );

      const cmd = findCommandHelp("instance", "set");
      expect(cmd).not.toBeNull();
      const cmdLines = captureStdout();
      printCommandHelp(cmd!);
      expect(cmdLines.some((line) => /--public-base-url/.test(line))).toBe(true);
      expect(cmdLines.some((line) => /instance set --public-base-url/.test(line))).toBe(true);
      expect(cmdLines.some((line) => /instance\.yaml/.test(line))).toBe(true);
      expect(cmdLines.some((line) => /instance show/.test(line))).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env["NO_COLOR"];
      } else {
        process.env["NO_COLOR"] = prev;
      }
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

  test("FORCE_COLOR enables ANSI even when stream is not a TTY", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        `process.env.FORCE_COLOR = "1";
delete process.env.NO_COLOR;
const { colorEnabled, style } = await import("./src/transports/cli/style.ts");
const stream = { isTTY: false };
if (!colorEnabled(stream)) process.exit(2);
if (style.green("ok") !== "\\u001b[32mok\\u001b[0m") process.exit(3);`,
      ],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    expect(proc.exitCode).toBe(0);
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
