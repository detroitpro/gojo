export function fmtTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}

export function shortSha(sha: string | null | undefined): string {
  if (!sha) {
    return "—";
  }
  return sha.length > 8 ? sha.slice(0, 8) : sha;
}

export function durationBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start) {
    return null;
  }
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  return Math.max(0, endMs - startMs);
}

export function fmtCost(
  usd: number | null | undefined,
  source?: string | null,
): string {
  if (usd == null || !Number.isFinite(usd)) {
    return "—";
  }
  const formatted =
    usd >= 1 ? `$${usd.toFixed(2)}` : usd >= 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(4)}`;
  if (source === "estimated") {
    return `~${formatted}`;
  }
  if (source === "reported") {
    return formatted;
  }
  return formatted;
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) {
    return "—";
  }
  return n.toLocaleString();
}
