import type { Repositories } from '@/infrastructure/persistence/repositories';
import type { Agent, Run } from '@/infrastructure/persistence/types';

import {
  decideHealEnqueue,
  HEAL_WINDOW_MS,
  type HealEnqueueDecision,
} from '../domain/heal';
import type { ParsedFailurePolicy } from '../domain/failure-policy';

export function decideHealEnqueueFromRepos(opts: {
  repos: Repositories;
  failedRun: Run;
  failedAgent: Agent;
  policy: ParsedFailurePolicy;
  now?: Date;
}): HealEnqueueDecision {
  const { repos, failedRun, failedAgent, policy, now = new Date() } = opts;
  const selfHeal = policy.selfHeal;

  const project = repos.projects.findById(failedAgent.projectId);
  const healer =
    selfHeal == null
      ? null
      : repos.agents.findEnabledByProjectAndName(failedAgent.projectId, selfHeal.agent);

  const threshold = selfHeal?.afterConsecutiveFailedRuns ?? 1;
  const consecutiveFailures =
    selfHeal == null
      ? 0
      : repos.runs.countConsecutiveFailuresForAgent(failedAgent.id, threshold);

  const since = new Date(now.getTime() - HEAL_WINDOW_MS).toISOString();
  const healRunsInWindow = repos.runs.countByProjectTriggerSince(
    failedAgent.projectId,
    'heal',
    since,
  );

  return decideHealEnqueue({
    failedRun: {
      trigger: failedRun.trigger,
      startedAt: failedRun.startedAt,
      errorMessage: failedRun.errorMessage,
    },
    failedAgent: {
      id: failedAgent.id,
      projectId: failedAgent.projectId,
      name: failedAgent.name,
    },
    policy,
    facts: {
      projectEnabled: project?.enabled ?? false,
      healerAgentId: healer?.id ?? null,
      consecutiveFailures,
      healRunsInWindow,
    },
  });
}
