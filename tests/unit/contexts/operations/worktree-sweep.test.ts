import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeUnlessCloud } from '../../../support/cloud';

import {
  countOrphanWorktrees,
  sweepOrphanWorktrees,
} from '@/contexts/operations/infrastructure/worktree-sweep';
import {
  addWorktree,
  commitAll,
  configLocal,
  createBranch,
  execGit,
  initRepo,
} from '@/infrastructure/git/git';
import { RunState } from '@shared/run-states';

describeUnlessCloud('operations/worktree-sweep', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test('removes orphan worktrees and keeps live ones', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-sweep-'));
    const repoPath = join(tempDir, 'repo');
    const worktreesRoot = join(tempDir, 'worktrees');
    mkdirSync(repoPath, { recursive: true });
    mkdirSync(worktreesRoot, { recursive: true });

    await initRepo(repoPath);
    await configLocal(repoPath, 'user.email', 'test@example.com');
    await configLocal(repoPath, 'user.name', 'Gojo Test');
    writeFileSync(join(repoPath, 'README.md'), '# sweep\n');
    await commitAll(repoPath, 'initial');

    const orphanBranch = 'gojo/run/agent/demo/2026-08-04/run-orphan';
    const liveBranch = 'gojo/run/agent/demo/2026-08-04/run-live';
    const orphanPath = join(worktreesRoot, orphanBranch.replace(/\//g, '__'));
    const livePath = join(worktreesRoot, liveBranch.replace(/\//g, '__'));

    await createBranch(repoPath, orphanBranch, 'main');
    await createBranch(repoPath, liveBranch, 'main');
    await addWorktree(repoPath, orphanPath, orphanBranch);
    await addWorktree(repoPath, livePath, liveBranch);

    const repos = {
      runs: {
        listNonTerminal: () => [
          { id: 'live-run', state: RunState.Running } as never,
        ],
      },
      attempts: {
        listByRun: (runId: string) =>
          runId === 'live-run'
            ? [{ workspacePath: livePath, branchName: liveBranch }]
            : [],
      },
    } as never;

    const counts = countOrphanWorktrees(worktreesRoot, repos);
    expect(counts.total).toBe(2);
    expect(counts.orphan).toBe(1);

    const result = await sweepOrphanWorktrees({ worktreesRoot, repos });
    expect(result.removed).toContain(orphanPath);
    expect(result.keptLive).toContain(livePath);

    const list = await execGit(repoPath, ['worktree', 'list', '--porcelain']);
    expect(list.stdout).not.toContain(orphanPath);
    expect(list.stdout).toContain(livePath);
  });
});
