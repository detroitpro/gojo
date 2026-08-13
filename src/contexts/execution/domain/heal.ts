import type { ParsedFailurePolicy } from './failure-policy';

const HEAL_WINDOW_MS = 60 * 60 * 1000;
const HEAL_MAX_PER_PROJECT = 3;

export interface HealRunSnapshot {
  trigger: string;
  startedAt: string | null;
  errorMessage: string | null;
}

export interface HealAgentSnapshot {
  id: string;
  projectId: string;
  name: string;
}

/** Pre-fetched facts the heal policy needs; loaded outside domain. */
export interface HealEnqueueFacts {
  projectEnabled: boolean;
  healerAgentId: string | null;
  consecutiveFailures: number;
  healRunsInWindow: number;
}

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
  failedRun: HealRunSnapshot;
  failedAgent: HealAgentSnapshot;
  policy: ParsedFailurePolicy;
  facts: HealEnqueueFacts;
}): HealEnqueueDecision {
  const { failedRun, failedAgent, policy, facts } = opts;
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

  if (!facts.projectEnabled) {
    return { shouldEnqueue: false, reason: 'project is disabled' };
  }

  if (!facts.healerAgentId) {
    return { shouldEnqueue: false, reason: `healer agent not found: ${selfHeal.agent}` };
  }

  const threshold = selfHeal.afterConsecutiveFailedRuns ?? 1;
  if (facts.consecutiveFailures < threshold) {
    return {
      shouldEnqueue: false,
      reason: `consecutive failures ${facts.consecutiveFailures} < threshold ${threshold}`,
    };
  }

  if (facts.healRunsInWindow >= HEAL_MAX_PER_PROJECT) {
    return {
      shouldEnqueue: false,
      reason: `heal cap reached (${HEAL_MAX_PER_PROJECT}/${HEAL_WINDOW_MS}ms)`,
    };
  }

  return {
    shouldEnqueue: true,
    healerAgentId: facts.healerAgentId,
    reason: 'enqueue healer',
  };
}

export { HEAL_MAX_PER_PROJECT, HEAL_WINDOW_MS };
