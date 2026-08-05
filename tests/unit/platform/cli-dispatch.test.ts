import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { z } from "zod";

import { err, ok } from "@/kernel";
import { createAppContext } from "@/platform/app-context";
import { tryDispatchCliUseCase } from "@/platform/cli-dispatch";
import {
  createUseCaseRegistry,
  defineCommand,
  defineQuery,
} from "@/platform/registry";
import { ExitCode } from "@/transports/cli/errors";

describe("platform/cli-dispatch", () => {
  let tempDir: string | null = null;
  let ctx: Awaited<ReturnType<typeof createAppContext>> | null = null;
  const spies: Array<ReturnType<typeof spyOn>> = [];

  afterEach(async () => {
    for (const spy of spies) {
      spy.mockRestore();
    }
    spies.length = 0;
    await ctx?.dispose();
    ctx = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function boot(): Promise<Awaited<ReturnType<typeof createAppContext>>> {
    tempDir = mkdtempSync(`${tmpdir()}/gojo-cli-dispatch-`);
    ctx = await createAppContext(tempDir);
    return ctx;
  }

  const EchoCli = defineQuery<{ message: string }, { message: string }>({
    name: "demo.cli.echo",
    input: z.object({ message: z.string() }),
    output: z.object({ message: z.string() }),
    cli: { group: "demo", command: "echo" },
    async handle(input) {
      return ok({ message: input.message });
    },
  });

  const FailCli = defineCommand<{ reason: string }, { ok: boolean }>({
    name: "demo.cli.fail",
    input: z.object({ reason: z.string() }),
    output: z.object({ ok: z.boolean() }),
    cli: { group: "demo", command: "fail" },
    async handle(input) {
      return err({ code: "demo.fail", message: input.reason });
    },
  });

  test("returns false when no CLI use case matches", async () => {
    const context = await boot();
    const registry = createUseCaseRegistry([EchoCli]);

    const handled = await tryDispatchCliUseCase(
      registry,
      context,
      "demo",
      "missing",
      {},
      "json",
    );

    expect(handled).toBe(false);
  });

  test("prints successful query output and returns true", async () => {
    const context = await boot();
    const registry = createUseCaseRegistry([EchoCli]);
    const lines: string[] = [];
    spies.push(
      spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      }),
    );

    const handled = await tryDispatchCliUseCase(
      registry,
      context,
      "demo",
      "echo",
      { message: "hi" },
      "json",
    );

    expect(handled).toBe(true);
    expect(JSON.parse(lines[0]!)).toEqual({ message: "hi" });
  });

  test("dies with usage exit code when command use case fails", async () => {
    const context = await boot();
    const registry = createUseCaseRegistry([FailCli]);
    const stderr: string[] = [];
    spies.push(
      spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        stderr.push(args.map(String).join(" "));
      }),
    );
    let exitCode: number | undefined;
    spies.push(
      spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
        exitCode = typeof code === "number" ? code : Number(code);
        throw new Error("process.exit");
      }),
    );

    await expect(
      tryDispatchCliUseCase(
        registry,
        context,
        "demo",
        "fail",
        { reason: "nope" },
        "json",
      ),
    ).rejects.toThrow("process.exit");

    expect(exitCode).toBe(ExitCode.Usage);
    expect(JSON.parse(stderr[0]!)).toEqual({ error: { message: "nope" } });
  });
});
