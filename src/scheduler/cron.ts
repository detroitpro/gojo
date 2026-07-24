import { Cron } from "croner";

/** Returns the next `count` cron occurrences after `from` in the given timezone. */
export function nextOccurrences(
  cron: string,
  timezone: string,
  from: Date,
  count: number,
): Date[] {
  if (count <= 0) {
    return [];
  }

  const job = new Cron(cron, { timezone, paused: true });
  return job.nextRuns(count, from);
}

/** Collects all cron occurrences strictly after `after` and up to and including `until`. */
export function missedOccurrences(
  cron: string,
  timezone: string,
  after: Date,
  until: Date,
): Date[] {
  const missed: Date[] = [];
  const job = new Cron(cron, { timezone, paused: true });
  let cursor: Date | null = after;

  for (let i = 0; i < 10_000; i++) {
    const next = job.nextRun(cursor);
    if (next === null || next.getTime() > until.getTime()) {
      break;
    }
    missed.push(next);
    cursor = next;
  }

  return missed;
}

/** Returns the next cron occurrence strictly after `from`. */
export function nextOccurrence(cron: string, timezone: string, from: Date): Date | null {
  const [next] = nextOccurrences(cron, timezone, from, 1);
  return next ?? null;
}
