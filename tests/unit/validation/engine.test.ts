import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseTimeout, runValidationProfile } from '@/validation/engine';

describe('validation/engine', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test('parseTimeout converts duration strings', () => {
    expect(parseTimeout('500ms')).toBe(500);
    expect(parseTimeout('30s')).toBe(30_000);
    expect(parseTimeout('10m')).toBe(600_000);
    expect(parseTimeout('1h')).toBe(3_600_000);
  });

  test('parseTimeout rejects invalid strings', () => {
    expect(() => parseTimeout('10x')).toThrow(/Invalid timeout format/);
  });

  test('runValidationProfile passes when all steps succeed', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-validation-test-'));

    const result = await runValidationProfile({
      cwd: tempDir,
      steps: [
        { name: 'always-true', command: 'true' },
        { name: 'echo-ok', command: 'echo ok' },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.status).toBe('passed');
    expect(result.results[1]?.status).toBe('passed');
  });

  test('runValidationProfile stops on first failure', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-validation-fail-test-'));

    const result = await runValidationProfile({
      cwd: tempDir,
      steps: [
        { name: 'fail', command: 'exit 1' },
        { name: 'skipped', command: 'true' },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe('failed');
  });

  test('runValidationProfile honors step timeout', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-validation-timeout-test-'));

    const result = await runValidationProfile({
      cwd: tempDir,
      steps: [{ name: 'sleep', command: 'sleep 2', timeout: '100ms' }],
    });

    expect(result.passed).toBe(false);
    expect(result.results[0]?.status).toBe('timed_out');
  });

  test('runValidationProfile validates file existence', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-validation-file-test-'));
    writeFileSync(join(tempDir, 'marker.txt'), 'present');

    const result = await runValidationProfile({
      cwd: tempDir,
      steps: [{ name: 'file-exists', command: 'test -f marker.txt' }],
    });

    expect(result.passed).toBe(true);
  });

  test('empty profile passes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-validation-empty-test-'));

    const result = await runValidationProfile({
      cwd: tempDir,
      steps: [],
    });

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  test('runValidationProfile cancels when signal is already aborted', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-validation-abort-test-'));
    const controller = new AbortController();
    controller.abort();

    const steps: Array<{ name: string; command: string }> = [];
    const onStep = (result: { status: string }) => {
      steps.push({ name: result.status, command: '' });
    };

    const result = await runValidationProfile({
      cwd: tempDir,
      steps: [{ name: 'never-runs', command: 'true' }],
      signal: controller.signal,
      onStep,
    });

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe('canceled');
    expect(steps).toHaveLength(1);
  });
});
