/** Format next run as a short relative phrase (“in 6 hours”, “tonight”, …). */
export function formatRelativeNextRun(
  iso: string | null | undefined,
  nowMs = Date.now(),
  timeZone?: string | null,
): string {
  if (!iso) {
    return "—";
  }
  const targetMs = Date.parse(iso);
  if (!Number.isFinite(targetMs)) {
    return "—";
  }

  const deltaMs = targetMs - nowMs;
  if (deltaMs <= 0) {
    return "now";
  }

  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    return "in under a minute";
  }

  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) {
    return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
  }

  const hours = Math.round(deltaMs / 3_600_000);
  if (hours < 8) {
    return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  }

  const tz = timeZone?.trim() || undefined;
  const targetLocal = partsInZone(targetMs, tz);
  const nowLocal = partsInZone(nowMs, tz);

  if (isSameCalendarDay(nowLocal, targetLocal)) {
    return `tonight ${formatClock(targetLocal)}`;
  }

  const tomorrow = addCalendarDays(nowLocal, 1);
  if (isSameCalendarDay(tomorrow, targetLocal)) {
    return `tomorrow ${formatClock(targetLocal)}`;
  }

  const days = Math.round(deltaMs / 86_400_000);
  if (days <= 7) {
    return `${weekdayName(targetLocal)} ${formatClock(targetLocal)}`;
  }

  return formatAbsoluteInZone(iso, tz);
}

/** Absolute local time in a timezone (fallback display). */
export function formatAbsoluteInZone(
  iso: string | null | undefined,
  timeZone?: string | null,
): string {
  if (!iso) {
    return "—";
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return "—";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      ...(timeZone?.trim() ? { timeZone: timeZone.trim() } : {}),
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function formatTimezoneLabel(timeZone: string | null | undefined): string {
  const tz = timeZone?.trim();
  if (!tz) {
    return "—";
  }
  return tz;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

function partsInZone(ms: number, timeZone?: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const map = Object.fromEntries(
    fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: map.weekday ?? "",
  };
}

function isSameCalendarDay(a: ZonedParts, b: ZonedParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function addCalendarDays(parts: ZonedParts, days: number): ZonedParts {
  // Noon UTC on the calendar date avoids DST edge surprises when comparing Y/M/D only.
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0);
  return partsInZone(utc, "UTC");
}

function formatClock(parts: ZonedParts): string {
  const h24 = parts.hour;
  const minute = parts.minute.toString().padStart(2, "0");
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${minute} ${period}`;
}

function weekdayName(parts: ZonedParts): string {
  return parts.weekday || "soon";
}
