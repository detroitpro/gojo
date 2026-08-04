import { createRepositories } from "@/platform/create-repositories";
import type { Database } from "@/infrastructure/persistence/db";

/** Returns true when consecutive failures meet or exceed the disable threshold. */
export function shouldDisableSchedule(
  consecutiveFailures: number,
  threshold: number | null,
): boolean {
  if (threshold === null) {
    return false;
  }
  return consecutiveFailures >= threshold;
}

/** Records a run outcome, updating failure counters and disabling when threshold is reached. */
export async function recordRunOutcome(
  db: Database,
  scheduleId: string,
  success: boolean,
): Promise<{ disabled: boolean }> {
  const repos = createRepositories(db);
  const schedule = repos.schedules.findById(scheduleId);
  if (!schedule) {
    return { disabled: false };
  }

  if (success) {
    repos.schedules.resetFailures(scheduleId);
    return { disabled: false };
  }

  const consecutiveFailures = repos.schedules.incrementFailures(scheduleId);
  const disabled = shouldDisableSchedule(consecutiveFailures, schedule.disableAfter);
  if (disabled) {
    repos.schedules.disable(scheduleId);
  }

  return { disabled };
}
