import { expect, test } from 'bun:test';

import {
  DEFAULT_AGENT_TIMEOUT_MS,
  resolveAgentTimeoutMs,
} from '@/contexts/execution/infrastructure/agent-timeout';
import type { Profile } from '@/infrastructure/persistence/types';

function profiles(map: Record<string, Partial<Profile>>) {
  return {
    findById(id: string): Profile | null {
      const row = map[id];
      if (!row) return null;
      return {
        id,
        projectId: row.projectId ?? 'p1',
        name: row.name ?? 'cursor',
        adapter: row.adapter ?? 'cursor',
        configJson: row.configJson ?? '{}',
        createdAt: row.createdAt ?? new Date().toISOString(),
      };
    },
  };
}

test('resolveAgentTimeoutMs uses default when profile missing', () => {
  expect(resolveAgentTimeoutMs({ profileId: null }, profiles({}))).toBe(
    DEFAULT_AGENT_TIMEOUT_MS,
  );
  expect(resolveAgentTimeoutMs({ profileId: 'missing' }, profiles({}))).toBe(
    DEFAULT_AGENT_TIMEOUT_MS,
  );
});

test('resolveAgentTimeoutMs reads profile timeout', () => {
  const ms = resolveAgentTimeoutMs(
    { profileId: 'prof' },
    profiles({
      prof: { configJson: JSON.stringify({ adapter: 'cursor', timeout: '45m' }) },
    }),
  );
  expect(ms).toBe(45 * 60 * 1000);
});

test('resolveAgentTimeoutMs throws on malformed timeout', () => {
  expect(() =>
    resolveAgentTimeoutMs(
      { profileId: 'prof' },
      profiles({
        prof: { configJson: JSON.stringify({ adapter: 'cursor', timeout: 'nope' }) },
      }),
    ),
  ).toThrow(/Invalid timeout format/);
});

test('resolveAgentTimeoutMs uses default when profile configJson is not an object', () => {
  expect(
    resolveAgentTimeoutMs(
      { profileId: 'prof' },
      profiles({
        prof: { configJson: 'not-json' },
      }),
    ),
  ).toBe(DEFAULT_AGENT_TIMEOUT_MS);
  expect(
    resolveAgentTimeoutMs(
      { profileId: 'prof' },
      profiles({
        prof: { configJson: '[]' },
      }),
    ),
  ).toBe(DEFAULT_AGENT_TIMEOUT_MS);
});
