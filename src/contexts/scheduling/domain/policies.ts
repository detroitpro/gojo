/**
 * Pure scheduling overlap / missed-run policies.
 * Overlap / missed-run pure policies (canonical home for scheduling domain).
 */

export type OverlapPolicy = "skip" | "queue" | "cancel_replace" | "allow_parallel";
export type MissedRunPolicy = "skip" | "run_once" | "run_all" | "run_latest";

export type OverlapDecision = "start" | "skip" | "queue" | "cancel_replace";

/** Determines whether a new run should start given overlap state and policy. */
export function shouldStartGivenOverlap(
  policy: OverlapPolicy,
  hasActiveRun: boolean,
  queuedCount: number,
): OverlapDecision {
  if (!hasActiveRun) {
    return "start";
  }

  switch (policy) {
    case "skip":
      return "skip";
    case "queue":
      return queuedCount > 0 ? "skip" : "queue";
    case "cancel_replace":
      return "cancel_replace";
    case "allow_parallel":
      return "start";
    default: {
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }
}

/** Selects which missed run timestamps to fire after downtime. */
export function selectMissedRuns(policy: MissedRunPolicy, missed: Date[]): Date[] {
  if (missed.length === 0) {
    return [];
  }

  switch (policy) {
    case "skip":
      return [];
    case "run_once":
      return [missed[0]!];
    case "run_all":
      return [...missed];
    case "run_latest":
      return [missed[missed.length - 1]!];
    default: {
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }
}
