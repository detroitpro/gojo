import { describe, expect, test } from 'bun:test';

import {
  appendValidationPrompt,
  appendValidationPromptAsShellComments,
  formatValidationFailureMessage,
} from '@/contexts/execution/infrastructure/coordinator';
import type { ValidationStepResult } from '@/contexts/execution/infrastructure/validation/engine';

describe('appendValidationPrompt', () => {
  test('returns prompt unchanged when there are no steps', () => {
    expect(appendValidationPrompt('do the work', [])).toBe('do the work');
  });

  test('appends exact validation commands', () => {
    const out = appendValidationPrompt('do the work', [
      {
        name: 'dotnet-test',
        command: 'dotnet test -c Release agents/dotnet/Tests.csproj',
        timeout: '15m',
      },
    ]);

    expect(out).toContain('do the work');
    expect(out).toContain('## Gojo validation (exact commands)');
    expect(out).toContain('**dotnet-test** (timeout 15m)');
    expect(out).toContain('dotnet test -c Release agents/dotnet/Tests.csproj');
  });
});

describe('appendValidationPromptAsShellComments', () => {
  test('appends validation as shell comments so scripts stay executable', () => {
    const out = appendValidationPromptAsShellComments('#!/bin/sh\necho hi', [
      { name: 'check', command: 'test -f out.txt', timeout: '30s' },
    ]);
    expect(out.startsWith('#!/bin/sh')).toBe(true);
    expect(out).toContain('echo hi');
    expect(out).toContain('# Gojo validation (exact commands)');
    expect(out).toContain('# 1. check (timeout 30s)');
    expect(out).toContain('# test -f out.txt');
    expect(out.includes('\n## ')).toBe(false);
  });
});

describe('formatValidationFailureMessage', () => {
  test('includes step name, exit code, and output tail', () => {
    const results: ValidationStepResult[] = [
      {
        name: 'dotnet-test',
        command: 'dotnet test --project x.csproj',
        exitCode: 1,
        status: 'failed',
        stdout: 'MSBUILD : error MSB1001: Unknown switch.\nSwitch: --project\n',
        stderr: '',
        durationMs: 12,
      },
    ];

    const message = formatValidationFailureMessage(results);
    expect(message).toContain('Validation failed: dotnet-test (failed, exit 1)');
    expect(message).toContain('Unknown switch');
    expect(message).toContain('--project');
  });

  test('works without output', () => {
    const results: ValidationStepResult[] = [
      {
        name: 'noop',
        command: 'false',
        exitCode: 1,
        status: 'failed',
        stdout: '',
        stderr: '',
        durationMs: 1,
      },
    ];
    expect(formatValidationFailureMessage(results)).toBe(
      'Validation failed: noop (failed, exit 1)',
    );
  });
});
