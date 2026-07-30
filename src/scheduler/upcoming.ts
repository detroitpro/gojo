import type { Database } from '@/storage/db';
import { listSchedulesPage } from '@/storage/paged-lists';

import { nextOccurrences } from './cron';
import { scheduleColorFromId } from './schedule-color';

const MAX_SCHEDULES = 100;
const MAX_FIRES_PER_SCHEDULE = 500;

export interface UpcomingSchedulesInput {
  horizonHours: number;
  projectId?: string | null;
  enabled?: boolean | null;
  q?: string | null;
  now?: Date;
}

export interface UpcomingScheduleSeries {
  id: string;
  name: string;
  agentName: string | null;
  timezone: string;
  enabled: boolean;
  color: string;
  fires: string[];
}

export interface UpcomingSchedulesResult {
  horizonHours: number;
  from: string;
  to: string;
  schedules: UpcomingScheduleSeries[];
}

function clampHorizonHours(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 168;
  }
  return Math.min(Math.max(Math.floor(raw), 1), 24 * 90);
}

/** Expand next cron fires for schedules matching filters within a time horizon. */
export function listUpcomingSchedules(
  db: Database,
  input: UpcomingSchedulesInput,
): UpcomingSchedulesResult {
  const horizonHours = clampHorizonHours(input.horizonHours);
  const from = input.now ?? new Date();
  const to = new Date(from.getTime() + horizonHours * 60 * 60 * 1000);

  const page = listSchedulesPage(db, {
    limit: MAX_SCHEDULES,
    offset: 0,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.q !== undefined ? { q: input.q } : {}),
  });

  const schedules: UpcomingScheduleSeries[] = page.items.map((schedule) => {
    let fires: string[] = [];
    try {
      const dates = nextOccurrences(
        schedule.cronExpr,
        schedule.timezone,
        from,
        MAX_FIRES_PER_SCHEDULE,
      );
      fires = dates
        .filter((d) => d.getTime() <= to.getTime())
        .map((d) => d.toISOString());
    } catch {
      fires = [];
    }
    return {
      id: schedule.id,
      name: schedule.name,
      agentName: schedule.agentName,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      color: scheduleColorFromId(schedule.id),
      fires,
    };
  });

  return {
    horizonHours,
    from: from.toISOString(),
    to: to.toISOString(),
    schedules,
  };
}
