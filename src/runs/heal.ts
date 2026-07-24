import type { Database } from '@/storage/db';
import { createRepositories } from '@/storage/repositories';
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
 * cap heal runs per project per hour.
 */
export function decideHealEnqueue(opts: {
  db: Database;
  failedRun: Run;
  failedTask: Task;
  policy: ParsedFailurePolicy;
}): HealEnqueueDecision {
  const { db, failedRun, failedTask, policy } = opts;
  const selfHeal = policy.selfHeal;
  if (!selfHeal) {
    return { shouldEnqueue: false, reason: 'no selfHeal configured' };
  }

  if (failedRun.trigger === 'heal') {
    return { shouldEnqueue: false, reason: 'heal runs do not re-trigger heal' };
  }

  if (failedTask.name === selfHeal.task) {
    return { shouldEnqueue: false, reason: 'healer task excluded from healing' };
  }

  const repos = createRepositories(db);
  const healer = repos.tasks
    .listByProject(failedTask.projectId)
    .find((task) => task.name === selfHeal.task && task.enabled);

  if (!healer) {
    return { shouldEnqueue: false, reason: `healer task not found: ${selfHeal.task}` };
  }

  const threshold = selfHeal.afterConsecutiveFailedRuns ?? 1;
  const recentFailed = countRecentFailedRuns(db, failedTask.id, threshold);
  if (recentFailed < threshold) {
    return {
      shouldEnqueue: false,
      reason: `consecutive failures ${recentFailed} < threshold ${threshold}`,
    };
  }

  const healCount = countRecentHealRuns(db, failedTask.projectId);
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

function countRecentFailedRuns(db: Database, taskId: string, limit: number): number {
  const rows = db
    .connection()
    .query<{ state: string }, [string, number]>(
      `SELECT state FROM runs
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(taskId, Math.max(limit * 5, 10));

  let consecutive = 0;
  for (const row of rows) {
    if (
      row.state === 'Failed' ||
      row.state === 'TimedOut' ||
      row.state === 'InfrastructureFailure'
    ) {
      consecutive += 1;
    } else if (row.state === 'Succeeded') {
      break;
    }
  }
  return consecutive;
}

function countRecentHealRuns(db: Database, projectId: string): number {
  const since = new Date(Date.now() - HEAL_WINDOW_MS).toISOString();
  const row = db
    .connection()
    .query<{ count: number }, [string, string]>(
      `SELECT COUNT(*) as count FROM runs
       WHERE project_id = ? AND trigger = 'heal' AND created_at >= ?`,
    )
    .get(projectId, since);
  return row?.count ?? 0;
}
