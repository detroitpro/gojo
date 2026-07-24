import type { Repositories } from '@/storage/repositories';
import type { Run, Task } from '@/storage/types';

import type { ParsedFailurePolicy } from './failure-policy';

const HEAL_WINDOW_MS = 60 * 60 * 1000;
const HEAL_MAX_PER_PROJECT = 3;

export interface HealEnqueueDecision {
  shouldEnqueue: boolean;
  healerTaskId?: string;
  reason: string;
}

/**
 * Decide whether to enqueue a project's self-heal task after a failed run.
 * Loop guards: heal trigger never re-heals; healer tasks don't heal themselves;
 * infra/preflight failures (never started / invalid transition) are skipped;
 * cap heal runs per project per hour.
 */
export function decideHealEnqueue(opts: {
  repos: Repositories;
  failedRun: Run;
  failedTask: Task;
  policy: ParsedFailurePolicy;
}): HealEnqueueDecision {
  const { repos, failedRun, failedTask, policy } = opts;
  const selfHeal = policy.selfHeal;
  if (!selfHeal) {
    return { shouldEnqueue: false, reason: 'no selfHeal configured' };
  }

  if (failedRun.trigger === 'heal') {
    return { shouldEnqueue: false, reason: 'heal runs do not re-trigger heal' };
  }

  if (failedRun.startedAt == null) {
    return { shouldEnqueue: false, reason: 'run never started (infra/preflight)' };
  }

  if (failedRun.errorMessage?.startsWith('Invalid run transition:')) {
    return { shouldEnqueue: false, reason: 'invalid state transition (infra)' };
  }

  if (failedTask.name === selfHeal.task) {
    return { shouldEnqueue: false, reason: 'healer task excluded from healing' };
  }

  const healer = repos.tasks.findEnabledByProjectAndName(failedTask.projectId, selfHeal.task);

  if (!healer) {
    return { shouldEnqueue: false, reason: `healer task not found: ${selfHeal.task}` };
  }

  const threshold = selfHeal.afterConsecutiveFailedRuns ?? 1;
  const recentFailed = repos.runs.countConsecutiveFailuresForTask(failedTask.id, threshold);
  if (recentFailed < threshold) {
    return {
      shouldEnqueue: false,
      reason: `consecutive failures ${recentFailed} < threshold ${threshold}`,
    };
  }

  const since = new Date(Date.now() - HEAL_WINDOW_MS).toISOString();
  const healCount = repos.runs.countByProjectTriggerSince(failedTask.projectId, 'heal', since);
  if (healCount >= HEAL_MAX_PER_PROJECT) {
    return {
      shouldEnqueue: false,
      reason: `heal cap reached (${HEAL_MAX_PER_PROJECT}/${HEAL_WINDOW_MS}ms)`,
    };
  }

  return {
    shouldEnqueue: true,
    healerTaskId: healer.id,
    reason: 'enqueue healer',
  };
}
