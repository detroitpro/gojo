import type { ProcessRunResult, ProcessRunner } from "../ports/process-runner";

/**
 * Bun-native process runner. Preferred by ops for service control (systemctl /
 * launchctl) and backup restore. Kept as a port so tests can substitute a fake.
 */
export class BunProcessRunner implements ProcessRunner {
  async run(command: readonly string[]): Promise<ProcessRunResult> {
    const proc = Bun.spawn([...command], { stdout: "inherit", stderr: "inherit" });
    await proc.exited;
    return { exitCode: proc.exitCode };
  }
}
