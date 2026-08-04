/**
 * Minimal side-effect port for spawning short-lived processes.
 * Kept intentionally small so `service` control (systemctl / launchctl) can
 * migrate onto the same seam as `backup` restore later.
 */
export interface ProcessRunResult {
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
}

export interface ProcessRunner {
  run(command: readonly string[]): Promise<ProcessRunResult>;
}
