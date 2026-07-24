import { describe, expect, test } from 'bun:test';

import { runProcess } from '@/process/supervisor';

describe('process/supervisor', () => {
  test('captures stdout and stderr separately', async () => {
    const result = await runProcess({
      command: 'sh',
      args: ['-c', 'echo out; echo err 1>&2'],
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('out');
    expect(result.stderr.trim()).toBe('err');
    expect(result.timedOut).toBe(false);
    expect(result.canceled).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('echo command succeeds', async () => {
    const result = await runProcess({
      command: 'echo',
      args: ['hello-gojo'],
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-gojo');
    expect(result.stderr).toBe('');
  });

  test('times out long-running processes', async () => {
    const result = await runProcess({
      command: 'sleep',
      args: ['10'],
      cwd: process.cwd(),
      timeoutMs: 200,
    });

    expect(result.timedOut).toBe(true);
    expect(result.canceled).toBe(false);
  });

  test('cancels via AbortSignal', async () => {
    const controller = new AbortController();

    const runPromise = runProcess({
      command: 'sleep',
      args: ['10'],
      cwd: process.cwd(),
      signal: controller.signal,
    });

    setTimeout(() => {
      controller.abort();
    }, 100);

    const result = await runPromise;

    expect(result.canceled).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  test('respects maxOutputBytes', async () => {
    const result = await runProcess({
      command: 'sh',
      args: ['-c', 'printf "%0100d" 1'],
      cwd: process.cwd(),
      maxOutputBytes: 16,
    });

    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(16);
  });

  test('invokes output callbacks', async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    await runProcess({
      command: 'sh',
      args: ['-c', 'echo out; echo err 1>&2'],
      cwd: process.cwd(),
      onStdout: (chunk) => {
        stdoutChunks.push(chunk);
      },
      onStderr: (chunk) => {
        stderrChunks.push(chunk);
      },
    });

    expect(stdoutChunks.join('').trim()).toBe('out');
    expect(stderrChunks.join('').trim()).toBe('err');
  });
});
