/**
 * Public surface of the scheduling context.
 * Other contexts may import only from this module.
 */
export type {
  OverlapDecision,
  OverlapPolicy,
  MissedRunPolicy,
} from "./domain/policies";
export { shouldStartGivenOverlap, selectMissedRuns } from "./domain/policies";

export {
  computeScheduleNextRun,
  missedOccurrences,
  nextOccurrence,
  nextOccurrences,
} from "./domain/cron";
export { scheduleColorFromId } from "./domain/schedule-color";
export { Scheduler, type SchedulerDeps } from "./infrastructure/scheduler-loop";
export {
  listUpcomingSchedules,
  type ListUpcomingSchedulesDeps,
  type UpcomingScheduleSeries,
  type UpcomingSchedulesInput,
  type UpcomingSchedulesResult,
} from "./application/upcoming";

export type { SchedulingPolicyStore } from "./ports/scheduling-policy-store";
export type { GetSchedulingPolicyDeps } from "./application/get-scheduling-policy";
export type { SetSchedulingPolicyDeps } from "./application/set-scheduling-policy";
export { getSchedulingPolicyQuery } from "./application/get-scheduling-policy";
export { setSchedulingPolicyCommand } from "./application/set-scheduling-policy";

export { readSchedulingPolicy } from "./infrastructure/read-policy";

export {
  recordRunOutcome,
  shouldDisableSchedule,
} from "./infrastructure/schedule-outcomes";
export {
  acquireSchedulerLease,
  refreshSchedulerLease,
  releaseSchedulerLease,
} from "./infrastructure/scheduler-leases";
