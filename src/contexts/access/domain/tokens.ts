/**
 * Pure token-projection helpers used by application queries.
 * No IO, no time.
 */

/** Minimal token shape needed by domain projections (infra records satisfy this). */
export type ApiTokenRecordLike = {
  id: string;
  name: string;
  scopesJson: string;
  createdAt: string;
  expiresAt: string | null;
};

export type ApiTokenView = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
};

export function parseScopes(scopesJson: string): string[] {
  try {
    const parsed = JSON.parse(scopesJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((scope): scope is string => typeof scope === "string");
  } catch {
    return [];
  }
}

export function toApiTokenView(record: ApiTokenRecordLike): ApiTokenView {
  return {
    id: record.id,
    name: record.name,
    scopes: parseScopes(record.scopesJson),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

/**
 * Tokens named `agent-run-*` are ephemeral per-run tokens that pollute admin views.
 * The dashboard filters them out unless `includeAgent` is explicitly requested.
 */
export function isAgentRunToken(record: Pick<ApiTokenRecordLike, "name">): boolean {
  return record.name.startsWith("agent-run-");
}

/** Case-insensitive substring search over `name` and `id`. */
export function matchesTokenQuery(token: ApiTokenView, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    token.name.toLowerCase().includes(needle) ||
    token.id.toLowerCase().includes(needle)
  );
}
