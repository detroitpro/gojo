import { describe, expect, test } from 'bun:test';

import {
  backoffMsFor,
  maxAttemptsFor,
  parseFailurePolicy,
} from '@/runs/failure-policy';

describe('parseFailurePolicy', () => {
  test('parses failure policy and embedded selfHeal', () => {
    const policy = parseFailurePolicy(
      JSON.stringify({
        maxAttemptsPerRun: 3,
        backoff: 'exponential',
        disableAfterConsecutiveFailedRuns: 2,
        selfHeal: { task: 'self-heal', afterConsecutiveFailedRuns: 1 },
      }),
    );
    expect(policy.maxAttemptsPerRun).toBe(3);
    expect(policy.backoff).toBe('exponential');
    expect(policy.selfHeal?.task).toBe('self-heal');
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
});
