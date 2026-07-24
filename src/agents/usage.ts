export type CostSource = 'reported' | 'estimated' | 'unknown';

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCostUsd: number | null;
  costSource: CostSource;
  durationMs?: number;
  durationApiMs?: number;
  model?: string;
  raw?: unknown;
}

export interface ModelPrice {
  /** USD per 1M input tokens */
  inputPerMillion: number;
  /** USD per 1M output tokens */
  outputPerMillion: number;
  /** USD per 1M cache-read tokens (defaults to input * 0.1) */
  cacheReadPerMillion?: number;
  /** USD per 1M cache-write tokens (defaults to input * 1.25) */
  cacheWritePerMillion?: number;
}

/** Approximate public list prices for estimation when the CLI omits USD. */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  default: {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  'claude-4-sonnet': {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  'claude-sonnet-4': {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  'claude-opus-4': {
    inputPerMillion: 15,
    outputPerMillion: 75,
  },
  'gpt-5': {
    inputPerMillion: 1.25,
    outputPerMillion: 10,
  },
  'gpt-4.1': {
    inputPerMillion: 2,
    outputPerMillion: 8,
  },
};

function normalizeModelKey(model: string | undefined): string {
  if (!model) {
    return 'default';
  }
  const lower = model.toLowerCase().replace(/\s+/g, '-');
  for (const key of Object.keys(DEFAULT_MODEL_PRICES)) {
    if (key !== 'default' && lower.includes(key)) {
      return key;
    }
  }
  if (lower.includes('opus')) {
    return 'claude-opus-4';
  }
  if (lower.includes('sonnet')) {
    return 'claude-4-sonnet';
  }
  if (lower.includes('gpt-5')) {
    return 'gpt-5';
  }
  if (lower.includes('gpt-4')) {
    return 'gpt-4.1';
  }
  return 'default';
}

export function estimateCostUsd(
  usage: Pick<
    AgentUsage,
    'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'model'
  >,
): number {
  const price =
    DEFAULT_MODEL_PRICES[normalizeModelKey(usage.model)] ?? DEFAULT_MODEL_PRICES['default']!;
  const cacheReadRate = price.cacheReadPerMillion ?? price.inputPerMillion * 0.1;
  const cacheWriteRate = price.cacheWritePerMillion ?? price.inputPerMillion * 1.25;
  const cost =
    (usage.inputTokens / 1_000_000) * price.inputPerMillion +
    (usage.outputTokens / 1_000_000) * price.outputPerMillion +
    (usage.cacheReadTokens / 1_000_000) * cacheReadRate +
    (usage.cacheWriteTokens / 1_000_000) * cacheWriteRate;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function withEstimatedCost(usage: AgentUsage): AgentUsage {
  if (usage.totalCostUsd != null && Number.isFinite(usage.totalCostUsd)) {
    return { ...usage, costSource: 'reported' };
  }
  const hasTokens =
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheReadTokens > 0 ||
    usage.cacheWriteTokens > 0;
  if (!hasTokens) {
    return { ...usage, totalCostUsd: null, costSource: 'unknown' };
  }
  return {
    ...usage,
    totalCostUsd: estimateCostUsd(usage),
    costSource: 'estimated',
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Parse Cursor CLI result / stream-json `usage` object. */
export function parseCursorUsage(
  payload: Record<string, unknown>,
  model?: string,
): AgentUsage | undefined {
  const usage = payload['usage'];
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }
  const u = usage as Record<string, unknown>;
  const inputTokens = num(u['inputTokens'] ?? u['input_tokens']);
  const outputTokens = num(u['outputTokens'] ?? u['output_tokens']);
  const cacheReadTokens = num(u['cacheReadTokens'] ?? u['cache_read_tokens']);
  const cacheWriteTokens = num(u['cacheWriteTokens'] ?? u['cache_write_tokens']);
  const reported =
    typeof payload['total_cost_usd'] === 'number'
      ? payload['total_cost_usd']
      : typeof u['totalCostUsd'] === 'number'
        ? u['totalCostUsd']
        : null;

  return withEstimatedCost({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalCostUsd: reported,
    costSource: reported != null ? 'reported' : 'unknown',
    ...(typeof payload['duration_ms'] === 'number'
      ? { durationMs: payload['duration_ms'] }
      : {}),
    ...(typeof payload['duration_api_ms'] === 'number'
      ? { durationApiMs: payload['duration_api_ms'] }
      : {}),
    ...(model ? { model } : {}),
    raw: usage,
  });
}

/** Parse Claude Code `--output-format json` result. */
export function parseClaudeUsage(payload: Record<string, unknown>): AgentUsage | undefined {
  const usage = payload['usage'];
  if (!usage || typeof usage !== 'object') {
    if (typeof payload['total_cost_usd'] !== 'number') {
      return undefined;
    }
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: payload['total_cost_usd'],
      costSource: 'reported',
      ...(typeof payload['duration_ms'] === 'number'
        ? { durationMs: payload['duration_ms'] }
        : {}),
      raw: payload,
    };
  }

  const u = usage as Record<string, unknown>;
  const modelUsage = payload['modelUsage'];
  const model =
    typeof payload['model'] === 'string'
      ? payload['model']
      : modelUsage &&
          typeof modelUsage === 'object' &&
          typeof (modelUsage as { model?: string }).model === 'string'
        ? (modelUsage as { model: string }).model
        : undefined;

  return withEstimatedCost({
    inputTokens: num(u['input_tokens'] ?? u['inputTokens']),
    outputTokens: num(u['output_tokens'] ?? u['outputTokens']),
    cacheReadTokens: num(
      u['cache_read_input_tokens'] ?? u['cache_read_tokens'] ?? u['cacheReadTokens'],
    ),
    cacheWriteTokens: num(
      u['cache_creation_input_tokens'] ?? u['cache_write_tokens'] ?? u['cacheWriteTokens'],
    ),
    totalCostUsd:
      typeof payload['total_cost_usd'] === 'number' ? payload['total_cost_usd'] : null,
    costSource: typeof payload['total_cost_usd'] === 'number' ? 'reported' : 'unknown',
    ...(typeof payload['duration_ms'] === 'number'
      ? { durationMs: payload['duration_ms'] }
      : {}),
    ...(model ? { model } : {}),
    raw: usage,
  });
}

export function emptyUsage(): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCostUsd: null,
    costSource: 'unknown',
  };
}
