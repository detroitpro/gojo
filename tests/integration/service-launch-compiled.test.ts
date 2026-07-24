import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Regression: Bun-compiled binaries set process.argv[0] to the bare string "bun".
 * Service install must use process.execPath (the real binary) or systemd fails
 * with status=203/EXEC when ExecStart=bun …
 */
describe("compiled service launch regression", () => {
  const dir = join(tmpdir(), `gojo-service-launch-${Date.now()}`);
  const probeTs = join(dir, "probe.ts");
  const probeBin = join(dir, "probe");

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("compiled binary reports argv0=bun but execPath=outfile; launch must use execPath", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      probeTs,
      `
const home = "/tmp/gojo-home-probe";
const entry = import.meta.path;
const compiled = entry.startsWith("/$bunfs/");
const launch = compiled
  ? { execPath: process.execPath, args: ["server", "start", "--home", home] }
  : { execPath: process.execPath, args: [entry, "server", "start", "--home", home] };
const buggyArgv0 = process.argv[0];
console.log(JSON.stringify({
  compiled,
  argv0: buggyArgv0,
  execPath: process.execPath,
  launch,
}));
`,
      "utf8",
    );

    const build = Bun.spawn(
      ["bun", "build", probeTs, "--compile", "--outfile", probeBin],
      { stdout: "pipe", stderr: "pipe" },
    );
    const buildCode = await build.exited;
    expect(buildCode).toBe(0);

    const run = Bun.spawn([probeBin], { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(run.stdout).text();
    const code = await run.exited;
    expect(code).toBe(0);

    const report = JSON.parse(stdout.trim()) as {
      compiled: boolean;
      argv0: string;
      execPath: string;
      launch: { execPath: string; args: string[] };
    };

    expect(report.compiled).toBe(true);
    expect(report.argv0).toBe("bun");
    expect(report.execPath).toBe(probeBin);
    expect(report.launch.execPath).toBe(probeBin);
    expect(report.launch.execPath).not.toBe("bun");
    expect(report.launch.args).toEqual(["server", "start", "--home", "/tmp/gojo-home-probe"]);

    // Document the exact broken ExecStart shape that caused 203/EXEC.
    const brokenExecStart = `${report.argv0} ${report.launch.args.join(" ")}`;
    expect(brokenExecStart).toBe("bun server start --home /tmp/gojo-home-probe");
    const fixedExecStart = `${report.launch.execPath} ${report.launch.args.join(" ")}`;
    expect(fixedExecStart.startsWith(probeBin)).toBe(true);
    expect(fixedExecStart.startsWith("bun ")).toBe(false);
  });
});
