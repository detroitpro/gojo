import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { assembleAgentPrompt } from '@/runs/prompt-assembly';

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'gojo-prompt-'));
}

describe('assembleAgentPrompt', () => {
  test('AI: prepends notice and instruction files before task prompt, then validation', () => {
    const root = tempWorkspace();
    mkdirSync(join(root, '.gojo'), { recursive: true });
    writeFileSync(join(root, '.gojo', 'instructions.md'), '# Shared\n\nBe minimal.\n');
    writeFileSync(join(root, 'AGENTS.md'), 'Repo agents note.\n');

    const out = assembleAgentPrompt({
      taskPrompt: '## Role\n\nDo the task.\n',
      adapterName: 'cursor',
      workspacePath: root,
      instructions: {
        scheduledRunNotice: 'Unattended scheduled run.',
        files: ['.gojo/instructions.md', 'AGENTS.md'],
      },
      validationSteps: [{ name: 'typecheck', command: 'bun run typecheck', timeout: '5m' }],
    });

    expect(out.indexOf('Unattended scheduled run.')).toBeLessThan(out.indexOf('# Shared'));
    expect(out.indexOf('# Shared')).toBeLessThan(out.indexOf('## Role'));
    expect(out.indexOf('Repo agents note.')).toBeLessThan(out.indexOf('## Role'));
    expect(out.indexOf('## Role')).toBeLessThan(out.indexOf('## Gojo validation'));
    expect(out).toContain('bun run typecheck');
  });

  test('AI: task prompt alone when instructions omitted', () => {
    const out = assembleAgentPrompt({
      taskPrompt: 'do work',
      adapterName: 'claude',
      workspacePath: tempWorkspace(),
      validationSteps: [],
    });
    expect(out).toBe('do work');
  });

  test('AI: fails fast when a listed instruction file is missing', () => {
    expect(() =>
      assembleAgentPrompt({
        taskPrompt: 'do work',
        adapterName: 'cursor',
        workspacePath: tempWorkspace(),
        instructions: { files: ['missing.md'] },
        validationSteps: [],
      }),
    ).toThrow(/missing\.md/);
  });

  test('AI: rejects instruction paths that escape the workspace', () => {
    expect(() =>
      assembleAgentPrompt({
        taskPrompt: 'do work',
        adapterName: 'cursor',
        workspacePath: tempWorkspace(),
        instructions: { files: ['../outside.md'] },
        validationSteps: [],
      }),
    ).toThrow(/escapes workspace/);
  });

  test('shell: skips instructions and only comment-appends validation', () => {
    const root = tempWorkspace();
    writeFileSync(join(root, 'AGENTS.md'), 'should not appear\n');

    const out = assembleAgentPrompt({
      taskPrompt: '#!/bin/sh\necho hi\n',
      adapterName: 'shell',
      workspacePath: root,
      instructions: {
        scheduledRunNotice: 'Unattended',
        files: ['AGENTS.md'],
      },
      validationSteps: [{ name: 'check', command: 'test -f out.txt' }],
    });

    expect(out).not.toContain('Unattended');
    expect(out).not.toContain('should not appear');
    expect(out.startsWith('#!/bin/sh')).toBe(true);
    expect(out).toContain('# Gojo validation');
    expect(out).toContain('# test -f out.txt');
  });
});
