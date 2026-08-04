/** Lenient JSON.parse; returns `fallback` on syntax errors (default `{}`). */
export function parseJson(value: string, fallback: unknown = {}): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

/** Parse a JSON object record; rejects arrays/primitives and returns `{}` on failure. */
export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
