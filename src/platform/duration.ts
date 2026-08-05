const TIMEOUT_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/;

/** Parse duration strings like "10m", "30s", "1h" into milliseconds. */
export function parseTimeout(timeout: string): number {
  const match = TIMEOUT_PATTERN.exec(timeout.trim());
  if (!match) {
    throw new Error(`Invalid timeout format: ${timeout}`);
  }

  const value = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1_000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    default:
      throw new Error(`Unsupported timeout unit: ${unit}`);
  }
}

/** True when the string is a supported duration (same grammar as parseTimeout). */
export function isTimeoutString(value: string): boolean {
  return TIMEOUT_PATTERN.test(value.trim());
}
