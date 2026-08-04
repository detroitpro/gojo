import { parseJsonObject } from '@shared/json';
import type { AgentFailurePolicy, AgentSelfHeal } from '@shared/manifest';

export interface ParsedFailurePolicy extends AgentFailurePolicy {
  selfHeal?: AgentSelfHeal;
}

const DEFAULT_MAX_ATTEMPTS = 1;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/** Parse failure_policy_json (may also embed selfHeal). */
export function parseFailurePolicy(json: string): ParsedFailurePolicy {
  const raw = parseJsonObject(json);
  const policy: ParsedFailurePolicy = {};

  if (typeof raw['maxAttemptsPerRun'] === 'number' && raw['maxAttemptsPerRun'] > 0) {
    policy.maxAttemptsPerRun = Math.floor(raw['maxAttemptsPerRun']);
  }
  if (
    typeof raw['disableAfterConsecutiveFailedRuns'] === 'number' &&
    raw['disableAfterConsecutiveFailedRuns'] > 0
  ) {
    policy.disableAfterConsecutiveFailedRuns = Math.floor(
      raw['disableAfterConsecutiveFailedRuns'],
    );
  }
  if (raw['backoff'] === 'exponential' || raw['backoff'] === 'linear' || raw['backoff'] === 'none') {
    policy.backoff = raw['backoff'];
  }

  const heal = raw['selfHeal'];
  if (heal && typeof heal === 'object' && heal !== null) {
    const record = heal as Record<string, unknown>;
    if (typeof record['agent'] === 'string' && record['agent'].length > 0) {
      policy.selfHeal = {
        agent: record['agent'],
        ...(typeof record['afterConsecutiveFailedRuns'] === 'number' &&
        record['afterConsecutiveFailedRuns'] > 0
          ? {
              afterConsecutiveFailedRuns: Math.floor(
                record['afterConsecutiveFailedRuns'],
              ),
            }
          : {}),
      };
    }
  }

  return policy;
}

export function maxAttemptsFor(policy: ParsedFailurePolicy): number {
  return policy.maxAttemptsPerRun ?? DEFAULT_MAX_ATTEMPTS;
}

/** Delay before attempt `attemptNumber` (1-based) after a failure. */
export function backoffMsFor(policy: ParsedFailurePolicy, attemptNumber: number): number {
  const mode = policy.backoff ?? 'none';
  if (mode === 'none' || attemptNumber <= 1) {
    return 0;
  }

  const n = attemptNumber - 1;
  if (mode === 'linear') {
    return Math.min(BACKOFF_BASE_MS * n, BACKOFF_MAX_MS);
  }

  // exponential
  return Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_MAX_MS);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
