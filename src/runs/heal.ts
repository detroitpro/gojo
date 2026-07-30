import type { Repositories } from '@/storage/repositories';
import type { Agent, Run } from '@/storage/types';

import type { ParsedFailurePolicy } from './failure-policy';

const HEAL_WINDOW_MS = 60 * 60 * 1000;
const HEAL_MAX_PER_PROJECT = 3;

export interface HealEnqueueDecision {
  shouldEnqueue: boolean;
  healerAgentId?: string;
  reason: string;
}

/**
 * Decide whether to enqueue a project's self-heal agent after a failed run.
 * Loop guards: heal trigger never re-heals; healer agents don't heal themselves;
 * infra/preflight failures (never started / invalid transition) are skipped;
 * cap heal runs per project per hour.
 */
export function decideHealEnqueue(opts: {
  repos: Repositories;
  failedRun: Run;
  failedAgent: Agent;
  policy: ParsedFailurePolicy;
}): HealEnqueueDecision {
  const { repos, failedRun, failedAgent, policy } = opts;
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

  if (failedAgent.name === selfHeal.agent) {
    return { shouldEnqueue: false, reason: 'healer agent excluded from healing' };
  }

  const healer = repos.agents.findEnabledByProjectAndName(failedAgent.projectId, selfHeal.agent);

  if (!healer) {
    return { shouldEnqueue: false, reason: `healer agent not found: ${selfHeal.agent}` };
  }

  const threshold = selfHeal.afterConsecutiveFailedRuns ?? 1;
  const recentFailed = repos.runs.countConsecutiveFailuresForAgent(failedAgent.id, threshold);
  if (recentFailed < threshold) {
    return {
      shouldEnqueue: false,
      reason: `consecutive failures ${recentFailed} < threshold ${threshold}`,
    };
  }

  const since = new Date(Date.now() - HEAL_WINDOW_MS).toISOString();
  const healCount = repos.runs.countByProjectTriggerSince(failedAgent.projectId, 'heal', since);
  if (healCount >= HEAL_MAX_PER_PROJECT) {
    return {
      shouldEnqueue: false,
      reason: `heal cap reached (${HEAL_MAX_PER_PROJECT}/${HEAL_WINDOW_MS}ms)`,
    };
  }

  return {
    shouldEnqueue: true,
    healerAgentId: healer.id,
    reason: 'enqueue healer',
  };
}
