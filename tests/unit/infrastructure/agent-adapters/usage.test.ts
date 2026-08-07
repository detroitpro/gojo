import { describe, expect, test } from 'bun:test';

import {
  emptyUsage,
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

  test('parseCursorUsage returns undefined when usage is missing or invalid', () => {
    expect(parseCursorUsage({})).toBeUndefined();
    expect(parseCursorUsage({ usage: 'bad' })).toBeUndefined();
  });

  test('parseClaudeUsage accepts cost-only payloads and modelUsage fallback', () => {
    const costOnly = parseClaudeUsage({ total_cost_usd: 0.01, duration_ms: 900 });
    expect(costOnly).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: 0.01,
      costSource: 'reported',
      durationMs: 900,
      raw: { total_cost_usd: 0.01, duration_ms: 900 },
    });

    const fromModelUsage = parseClaudeUsage({
      usage: { input_tokens: 10, output_tokens: 5 },
      modelUsage: { model: 'claude-opus-4' },
    });
    expect(fromModelUsage?.model).toBe('claude-opus-4');
    expect(fromModelUsage?.costSource).toBe('estimated');
  });

  test('estimateCostUsd maps model aliases and cache token rates', () => {
    const opus = estimateCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'Claude Opus 4',
    });
    expect(opus).toBe(15);

    const gpt5 = estimateCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'gpt-5-preview',
    });
    expect(gpt5).toBe(1.25);

    const cache = estimateCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      model: 'claude-4-sonnet',
    });
    expect(cache).toBe(4.05);
  });

  test('emptyUsage returns zeroed unknown cost', () => {
    expect(emptyUsage()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: null,
      costSource: 'unknown',
    });
  });
});
