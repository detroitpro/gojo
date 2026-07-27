import { z } from 'zod';

import type { RunTrigger } from '@/storage/types';

/** Instance-level admission policy. Cron times are suggestions; the dispatcher admits. */
export const SchedulingPolicySchema = z.object({
  maxConcurrentRuns: z.number().int().positive().default(2),
  maxConcurrentRunsPerProject: z.number().int().positive().default(1),
  /** Minimum gap between admissions (global). 0 disables. */
  minStartIntervalMs: z.number().int().nonnegative().default(30_000),
  /** Reject admission when loadavg[0]/cpus >= this. 0 disables the load guard. */
  maxLoadPerCpu: z.number().nonnegative().default(1.0),
});

export type SchedulingPolicy = z.infer<typeof SchedulingPolicySchema>;

export const DEFAULT_SCHEDULING_POLICY: SchedulingPolicy = SchedulingPolicySchema.parse({});

/** Lower number admits first. */
export const RUN_PRIORITY = {
  manual: 10,
  api: 10,
  web: 10,
  heal: 20,
  schedule: 30,
} as const satisfies Record<RunTrigger, number>;

export function priorityForTrigger(trigger: RunTrigger): number {
  return RUN_PRIORITY[trigger] ?? RUN_PRIORITY.schedule;
}

export function parseSchedulingPolicy(input: unknown): SchedulingPolicy {
  return SchedulingPolicySchema.parse(input ?? {});
}

export function safeParseSchedulingPolicy(input: unknown) {
  return SchedulingPolicySchema.safeParse(input ?? {});
}
