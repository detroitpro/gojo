import { describe, expect, test } from 'bun:test';

import {
  estimateCostUsd,
  parseClaudeUsage,
  parseCursorUsage,
  withEstimatedCost,
} from '@/infrastructure/agent-adapters/usage';

describe('agents/usage', () => {
  test('parseCursorUsage maps token fields and estimates cost', () => {
    const usage = parseCursorUsage(
      {
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        duration_ms: 1200,
      },
      'Claude 4 Sonnet',
    );

    expect(usage).toBeDefined();
    expect(usage!.inputTokens).toBe(1000);
    expect(usage!.outputTokens).toBe(500);
    expect(usage!.costSource).toBe('estimated');
    expect(usage!.totalCostUsd).toBeGreaterThan(0);
    expect(usage!.model).toBe('Claude 4 Sonnet');
  });

  test('parseClaudeUsage prefers reported total_cost_usd', () => {
    const usage = parseClaudeUsage({
      total_cost_usd: 0.042,
      usage: {
        input_tokens: 200,
        output_tokens: 100,
      },
      model: 'claude-sonnet-4',
    });

    expect(usage!.totalCostUsd).toBe(0.042);
    expect(usage!.costSource).toBe('reported');
  });

  test('estimateCostUsd uses per-million rates', () => {
    const cost = estimateCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-4-sonnet',
    });
    expect(cost).toBe(18);
  });

  test('withEstimatedCost leaves unknown when no tokens', () => {
    const usage = withEstimatedCost({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: null,
      costSource: 'unknown',
    });
    expect(usage.costSource).toBe('unknown');
    expect(usage.totalCostUsd).toBeNull();
  });
});
