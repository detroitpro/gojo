import type { SchedulingPolicy } from '@shared/scheduling';

export interface AdmissionCandidate {
  id: string;
  projectId: string;
  priority: number;
  notBeforeAt: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface AdmissionSnapshot {
  queued: AdmissionCandidate[];
  /** Counts of runs currently occupying a slot, keyed by projectId. */
  runningByProject: Record<string, number>;
  lastAdmittedAt: Date | null;
  /** os.loadavg()[0] / os.cpus().length */
  loadPerCpu: number;
}

export interface AdmissionDecision {
  admit: string[];
  expire: string[];
}

function compareCandidates(a: AdmissionCandidate, b: AdmissionCandidate): number {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  if (a.notBeforeAt !== b.notBeforeAt) {
    return a.notBeforeAt < b.notBeforeAt ? -1 : 1;
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function partitionQueued(
  queued: AdmissionCandidate[],
  nowIso: string,
): { expire: string[]; eligible: AdmissionCandidate[] } {
  const expire: string[] = [];
  const eligible: AdmissionCandidate[] = [];

  for (const run of queued) {
    if (run.expiresAt && run.expiresAt <= nowIso) {
      expire.push(run.id);
      continue;
    }
    if (run.notBeforeAt > nowIso) {
      continue;
    }
    eligible.push(run);
  }

  return { expire, eligible };
}

function isBlockedByLoad(snapshot: AdmissionSnapshot, policy: SchedulingPolicy): boolean {
  return policy.maxLoadPerCpu > 0 && snapshot.loadPerCpu >= policy.maxLoadPerCpu;
}

function isBlockedByStagger(
  snapshot: AdmissionSnapshot,
  policy: SchedulingPolicy,
  now: Date,
): boolean {
  return (
    policy.minStartIntervalMs > 0 &&
    snapshot.lastAdmittedAt !== null &&
    now.getTime() - snapshot.lastAdmittedAt.getTime() < policy.minStartIntervalMs
  );
}

/** Project ids in first-seen order for round-robin fairness. */
function projectIdsInOrder(candidates: AdmissionCandidate[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const run of candidates) {
    if (!seen.has(run.projectId)) {
      seen.add(run.projectId);
      order.push(run.projectId);
    }
  }
  return order;
}

function admitRoundRobin(
  eligible: AdmissionCandidate[],
  policy: SchedulingPolicy,
  runningByProject: Record<string, number>,
  globalRunning: number,
): { admit: string[]; runningByProject: Record<string, number>; globalRunning: number } {
  const admit: string[] = [];
  const remaining = [...eligible];
  let running = globalRunning;
  const byProject = { ...runningByProject };

  while (remaining.length > 0 && running < policy.maxConcurrentRuns) {
    const projectOrder = projectIdsInOrder(remaining);
    let admittedThisRound = false;

    for (const projectId of projectOrder) {
      if (running >= policy.maxConcurrentRuns) {
        break;
      }
      const projectRunning = byProject[projectId] ?? 0;
      if (projectRunning >= policy.maxConcurrentRunsPerProject) {
        continue;
      }
      const idx = remaining.findIndex((r) => r.projectId === projectId);
      if (idx < 0) {
        continue;
      }
      const [picked] = remaining.splice(idx, 1);
      if (!picked) {
        continue;
      }
      admit.push(picked.id);
      byProject[projectId] = projectRunning + 1;
      running += 1;
      admittedThisRound = true;
      // One admission per tick when stagger interval is set (prevents stampede).
      if (policy.minStartIntervalMs > 0) {
        return { admit, runningByProject: byProject, globalRunning: running };
      }
    }

    if (!admittedThisRound) {
      break;
    }
  }

  return { admit, runningByProject: byProject, globalRunning: running };
}

/**
 * Pure admission selection. Cron is a suggestion (`notBeforeAt`); this picks
 * who may start now under global/project caps with round-robin fairness.
 */
export function selectAdmissions(
  snapshot: AdmissionSnapshot,
  policy: SchedulingPolicy,
  now: Date,
): AdmissionDecision {
  const nowIso = now.toISOString();
  const { expire, eligible } = partitionQueued(snapshot.queued, nowIso);

  eligible.sort(compareCandidates);

  if (isBlockedByLoad(snapshot, policy) || isBlockedByStagger(snapshot, policy, now)) {
    return { admit: [], expire };
  }

  const globalRunning = Object.values(snapshot.runningByProject).reduce((a, b) => a + b, 0);
  const { admit } = admitRoundRobin(
    eligible,
    policy,
    snapshot.runningByProject,
    globalRunning,
  );

  return { admit, expire };
}
