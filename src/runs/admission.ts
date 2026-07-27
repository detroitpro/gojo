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
  const expire: string[] = [];
  const eligible: AdmissionCandidate[] = [];

  for (const run of snapshot.queued) {
    if (run.expiresAt && run.expiresAt <= nowIso) {
      expire.push(run.id);
      continue;
    }
    if (run.notBeforeAt > nowIso) {
      continue;
    }
    eligible.push(run);
  }

  eligible.sort(compareCandidates);

  if (
    policy.maxLoadPerCpu > 0 &&
    snapshot.loadPerCpu >= policy.maxLoadPerCpu
  ) {
    return { admit: [], expire };
  }

  if (
    policy.minStartIntervalMs > 0 &&
    snapshot.lastAdmittedAt &&
    now.getTime() - snapshot.lastAdmittedAt.getTime() < policy.minStartIntervalMs
  ) {
    return { admit: [], expire };
  }

  let globalRunning = Object.values(snapshot.runningByProject).reduce((a, b) => a + b, 0);
  const runningByProject = { ...snapshot.runningByProject };
  const admit: string[] = [];
  const remaining = [...eligible];

  while (remaining.length > 0 && globalRunning < policy.maxConcurrentRuns) {
    const projectOrder: string[] = [];
    for (const run of remaining) {
      if (!projectOrder.includes(run.projectId)) {
        projectOrder.push(run.projectId);
      }
    }

    let admittedThisRound = false;
    for (const projectId of projectOrder) {
      if (globalRunning >= policy.maxConcurrentRuns) {
        break;
      }
      const projectRunning = runningByProject[projectId] ?? 0;
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
      runningByProject[projectId] = projectRunning + 1;
      globalRunning += 1;
      admittedThisRound = true;
      // One admission per tick when stagger interval is set (prevents stampede).
      if (policy.minStartIntervalMs > 0) {
        return { admit, expire };
      }
    }

    if (!admittedThisRound) {
      break;
    }
  }

  return { admit, expire };
}
