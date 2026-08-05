import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeUnlessCloud } from '../../../support/cloud';

import {
  commitAll,
  configLocal,
  createBranch,
  findConflictingParentRef,
  initRepo,
} from '@/infrastructure/git/git';

describeUnlessCloud('git/findConflictingParentRef', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function createRepo(): Promise<string> {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-ref-conflict-'));
    const repoPath = join(tempDir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    await initRepo(repoPath);
    await configLocal(repoPath, 'user.email', 'test@example.com');
    await configLocal(repoPath, 'user.name', 'Gojo Test');
    writeFileSync(join(repoPath, 'README.md'), '# test\n');
    await commitAll(repoPath, 'initial');
    return repoPath;
  }

  test('returns null when no parent leaf exists', async () => {
    const repoPath = await createRepo();
    expect(
      await findConflictingParentRef(
        repoPath,
        'gojo/run/activity-digest/demo/2026-08-04/run-1',
      ),
    ).toBeNull();
  });

  test('detects a leaf parent that blocks nested refs', async () => {
    const repoPath = await createRepo();
    await createBranch(repoPath, 'gojo/run', 'main');
    expect(
      await findConflictingParentRef(
        repoPath,
        'gojo/run/activity-digest/demo/2026-08-04/run-1',
      ),
    ).toBe('gojo/run');
  });

  test('detects mid-path leaf conflicts', async () => {
    const repoPath = await createRepo();
    await createBranch(repoPath, 'gojo/run/activity-digest', 'main');
    expect(
      await findConflictingParentRef(
        repoPath,
        'gojo/run/activity-digest/demo/2026-08-04/run-1',
      ),
    ).toBe('gojo/run/activity-digest');
  });
});
