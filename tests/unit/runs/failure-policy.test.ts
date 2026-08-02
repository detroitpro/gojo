import { describe, expect, test } from 'bun:test';

import {
  backoffMsFor,
  maxAttemptsFor,
  parseFailurePolicy,
  sleep,
} from '@/runs/failure-policy';

describe('parseFailurePolicy', () => {
  test('parses failure policy and embedded selfHeal', () => {
    const policy = parseFailurePolicy(
      JSON.stringify({
        maxAttemptsPerRun: 3,
        backoff: 'exponential',
        disableAfterConsecutiveFailedRuns: 2,
        selfHeal: { agent: 'self-heal', afterConsecutiveFailedRuns: 1 },
      }),
    );
    expect(policy.maxAttemptsPerRun).toBe(3);
    expect(policy.backoff).toBe('exponential');
    expect(policy.selfHeal?.agent).toBe('self-heal');
    expect(policy.selfHeal?.afterConsecutiveFailedRuns).toBe(1);
  });

  test('defaults max attempts to 1', () => {
    expect(maxAttemptsFor({})).toBe(1);
    expect(maxAttemptsFor({ maxAttemptsPerRun: 4 })).toBe(4);
  });

  test('computes backoff delays', () => {
    expect(backoffMsFor({ backoff: 'none' }, 2)).toBe(0);
    expect(backoffMsFor({ backoff: 'linear' }, 2)).toBe(5_000);
    expect(backoffMsFor({ backoff: 'exponential' }, 2)).toBe(5_000);
    expect(backoffMsFor({ backoff: 'exponential' }, 3)).toBe(10_000);
  });

  test('tolerates invalid JSON and sleep handles zero and abort', async () => {
    expect(parseFailurePolicy('not-json')).toEqual({});

    await expect(sleep(0)).resolves.toBeUndefined();

    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1_000, controller.signal)).rejects.toThrow('aborted');
  });

  test('sleep rejects when aborted during wait', async () => {
    const controller = new AbortController();
    const promise = sleep(60_000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow('aborted');
  });

  test('sleep resolves after the delay elapses', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
  });
});
