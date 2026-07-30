import { describe, expect, test } from 'bun:test';

import {
  GENERATED_WORKSPACE_PATHS,
  gojoGitignoreBlock,
  isGeneratedWorkspacePath,
  REGISTRATION_PATHS,
} from '@shared/workspace-files';

describe('shared/workspace-files', () => {
  test('generated and registration paths do not overlap', () => {
    for (const generated of GENERATED_WORKSPACE_PATHS) {
      expect(REGISTRATION_PATHS).not.toContain(generated);
    }
  });

  test('isGeneratedWorkspacePath matches files and directory contents', () => {
    expect(isGeneratedWorkspacePath('.gojo/handoff.json')).toBe(true);
    expect(isGeneratedWorkspacePath('./.gojo/handoff.json')).toBe(true);
    expect(isGeneratedWorkspacePath('.gojo/run.sh')).toBe(true);
    expect(isGeneratedWorkspacePath('.gojo/assets')).toBe(true);
    expect(isGeneratedWorkspacePath('.gojo/assets/pr-body.md')).toBe(true);

    expect(isGeneratedWorkspacePath('.gojo/agents/maintain-tests.md')).toBe(false);
    expect(isGeneratedWorkspacePath('.gojo/instructions.md')).toBe(false);
    expect(isGeneratedWorkspacePath('gojo.yaml')).toBe(false);
    expect(isGeneratedWorkspacePath('src/handoff.json')).toBe(false);
  });

  test('gitignore block ignores .gojo then re-includes registration files', () => {
    const block = gojoGitignoreBlock();
    const lines = block.split('\n');

    expect(lines).toContain('.gojo/*');
    // Deny-then-re-include: the deny must precede every negation.
    const denyIndex = lines.indexOf('.gojo/*');
    for (const [index, line] of lines.entries()) {
      if (line.startsWith('!')) {
        expect(index).toBeGreaterThan(denyIndex);
      }
    }

    for (const path of REGISTRATION_PATHS.filter((p) => p.startsWith('.gojo/'))) {
      expect(block).toContain(`!${path}`);
    }
    for (const path of GENERATED_WORKSPACE_PATHS) {
      expect(block).not.toContain(`!${path}`);
    }
  });
});
