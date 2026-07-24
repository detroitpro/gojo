import { describe, expect, test } from 'bun:test';

import { claudeAgentAdapter } from '@/agents/claude/adapter';
import { cursorAgentAdapter } from '@/agents/cursor/adapter';
import { shellAgentAdapter } from '@/agents/shell/adapter';
import {
  getAdapter,
  getRegisteredAdapterNames,
  listAdapters,
  registerAdapter,
} from '@/agents/registry';

describe('agents/registry', () => {
  test('registers built-in adapters', () => {
    expect(getRegisteredAdapterNames()).toEqual([
      'claude-code',
      'cursor',
      'shell',
    ]);
  });

  test('gets adapters by name', () => {
    expect(getAdapter('shell')).toBe(shellAgentAdapter);
    expect(getAdapter('cursor')).toBe(cursorAgentAdapter);
    expect(getAdapter('claude-code')).toBe(claudeAgentAdapter);
    expect(getAdapter('missing')).toBeUndefined();
  });

  test('lists and overrides adapters', () => {
    const custom = {
      name: 'custom-agent',
      detect: async () => ({ installed: true }),
      execute: async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
        canceled: false,
      }),
    };

    registerAdapter(custom);
    expect(listAdapters().some((adapter) => adapter.name === 'custom-agent')).toBe(
      true,
    );
    expect(getAdapter('custom-agent')).toBe(custom);
  });
});
