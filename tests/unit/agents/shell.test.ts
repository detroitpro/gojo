import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { shellAgentAdapter } from '@/agents/shell/adapter';

describe('agents/shell', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test('detect reports shell availability', async () => {
    const status = await shellAgentAdapter.detect();
    expect(status.installed).toBe(true);
  });

  test('execute runs prompt script and parses handoff json', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-shell-agent-test-'));
    const workspacePath = join(tempDir, 'workspace');
    mkdirSync(workspacePath, { recursive: true });

    const handoff = { status: 'completed', summary: 'done' };
    const prompt = [
      '#!/bin/sh',
      'set -eu',
      'mkdir -p .gojo',
      `printf '%s' '${JSON.stringify(handoff)}' > .gojo/handoff.json`,
      'echo ran-shell-agent',
    ].join('\n');

    const controller = new AbortController();
    const result = await shellAgentAdapter.execute({
      workspacePath,
      prompt,
      env: {},
      timeoutMs: 10_000,
      signal: controller.signal,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('ran-shell-agent');
    expect(result.handoff).toEqual(handoff);
    expect(result.timedOut).toBe(false);
    expect(result.canceled).toBe(false);
  });

  test('execute surfaces script failures', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-shell-agent-fail-test-'));
    const workspacePath = join(tempDir, 'workspace');
    mkdirSync(workspacePath, { recursive: true });

    const result = await shellAgentAdapter.execute({
      workspacePath,
      prompt: '#!/bin/sh\nexit 7',
      env: {},
      timeoutMs: 10_000,
      signal: new AbortController().signal,
    });

    expect(result.exitCode).toBe(7);
  });
});
