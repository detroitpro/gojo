import cronstrue from 'cronstrue';

/** Human-readable English description of a cron expression; falls back to the raw expr. */
export function describeCron(cronExpr: string): string {
  const trimmed = cronExpr.trim();
  if (!trimmed) {
    return cronExpr;
  }
  try {
    return cronstrue.toString(trimmed, { throwExceptionOnParseError: true });
  } catch {
    return trimmed;
  }
}
