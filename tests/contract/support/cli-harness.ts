/**
 * Outside-in CLI harness for architecture behavior locks.
 * Spawns `bun run src/transports/cli/index.ts` so exit codes and process.exit paths are real.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../../..");

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  json: unknown | null;
};

export type CliHarness = {
  home: string;
  run: (args: string[]) => Promise<CliResult>;
  dispose: () => void;
};

export function createCliHarness(): CliHarness {
  const home = mkdtempSync(`${tmpdir()}/gojo-contract-cli-`);

  return {
    home,
    async run(args: string[]): Promise<CliResult> {
      const proc = Bun.spawn(
        ["bun", "run", join(REPO_ROOT, "src/transports/cli/index.ts"), "--home", home, "--output", "json", ...args],
        {
          cwd: REPO_ROOT,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            GOJO_HOME: home,
          },
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      let json: unknown | null = null;
      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        try {
          json = JSON.parse(trimmed);
        } catch {
          json = null;
        }
      }
      return { exitCode, stdout, stderr, json };
    },
    dispose() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}
