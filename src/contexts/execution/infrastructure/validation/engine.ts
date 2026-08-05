import { runProcess } from '@/infrastructure/process/supervisor';
import { parseTimeout } from '@/platform/duration';

export { parseTimeout };

export interface ValidationStepResult {
  name: string;
  command: string;
  exitCode: number | null;
  status: 'passed' | 'failed' | 'timed_out' | 'canceled';
  stdout: string;
  stderr: string;
  durationMs: number;
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
