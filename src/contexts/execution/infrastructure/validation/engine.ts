import { runProcess } from '@/infrastructure/process/supervisor';

export interface ValidationStepResult {
  name: string;
  command: string;
  exitCode: number | null;
  status: 'passed' | 'failed' | 'timed_out' | 'canceled';
  stdout: string;
  stderr: string;
  durationMs: number;
}

const TIMEOUT_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/;

/** Parse duration strings like "10m", "30s", "1h" into milliseconds. */
export function parseTimeout(timeout: string): number {
  const match = TIMEOUT_PATTERN.exec(timeout.trim());
  if (!match) {
    throw new Error(`Invalid timeout format: ${timeout}`);
  }

  const value = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1_000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    default:
      throw new Error(`Unsupported timeout unit: ${unit}`);
  }
}

export async function runValidationProfile(opts: {
  cwd: string;
  steps: Array<{ name: string; command: string; timeout?: string }>;
  /** Overlay for allowlisted project env vars (plus optional GOJO_* ids). */
  env?: Record<string, string>;
  signal?: AbortSignal;
  onStep?: (result: ValidationStepResult) => void;
}): Promise<{ passed: boolean; results: ValidationStepResult[] }> {
  const results: ValidationStepResult[] = [];

  for (const step of opts.steps) {
    if (opts.signal?.aborted) {
      const canceled: ValidationStepResult = {
        name: step.name,
        command: step.command,
        exitCode: null,
        status: 'canceled',
        stdout: '',
        stderr: '',
        durationMs: 0,
      };
      results.push(canceled);
      opts.onStep?.(canceled);
      return { passed: false, results };
    }

    const timeoutMs = step.timeout ? parseTimeout(step.timeout) : undefined;

    const result = await runProcess({
      command: 'sh',
      args: ['-c', step.command],
      cwd: opts.cwd,
      ...(opts.env !== undefined ? { env: opts.env } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });

    let status: ValidationStepResult['status'];
    if (result.canceled) {
      status = 'canceled';
    } else if (result.timedOut) {
      status = 'timed_out';
    } else if (result.exitCode === 0) {
      status = 'passed';
    } else {
      status = 'failed';
    }

    const stepResult: ValidationStepResult = {
      name: step.name,
      command: step.command,
      exitCode: result.exitCode,
      status,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
    };

    results.push(stepResult);
    opts.onStep?.(stepResult);

    if (status !== 'passed') {
      return { passed: false, results };
    }
  }

  return { passed: true, results };
}
