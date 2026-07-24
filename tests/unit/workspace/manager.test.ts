import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commitAll, configLocal, getHead, initRepo, statusPorcelain } from '@/git/git';
import { WorkspaceManager } from '@/workspace/manager';

describe('workspace/manager', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function createRepo(): Promise<{ repoPath: string; worktreesRoot: string }> {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-workspace-test-'));
    const repoPath = join(tempDir, 'repo');
    const worktreesRoot = join(tempDir, 'worktrees');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(repoPath, { recursive: true });

    await initRepo(repoPath);
    await configLocal(repoPath, 'user.email', 'test@example.com');
    await configLocal(repoPath, 'user.name', 'Gojo Test');
    writeFileSync(join(repoPath, 'README.md'), '# workspace test\n');
    await commitAll(repoPath, 'initial commit');

    return { repoPath, worktreesRoot };
  }

  test('prepareAttempt creates branch and worktree', async () => {
    const { repoPath, worktreesRoot } = await createRepo();
    const manager = new WorkspaceManager(worktreesRoot);
    const runId = '01JXYZABCDEFGHJKMNPQRSTVWX';

    const attempt = await manager.prepareAttempt({
      repoPath,
      baseBranch: 'main',
      runId,
      taskName: 'lint-fix',
    });

    const today = new Date().toISOString().slice(0, 10);
    expect(attempt.branchName).toBe(`gojo/lint-fix/${today}/run-01JXYZAB`);
    expect(attempt.worktreePath).toContain(`gojo__lint-fix__${today}__run-01JXYZAB`);
    expect(attempt.startingCommit).toBe(await getHead(repoPath));
  });

  test('prepareAttempt, write file, cleanup removes worktree and branch', async () => {
    const { repoPath, worktreesRoot } = await createRepo();
    const manager = new WorkspaceManager(worktreesRoot);

    const attempt = await manager.prepareAttempt({
      repoPath,
      baseBranch: 'main',
      runId: '01JXYZABCDEFGHJKMNPQRSTVWX',
      taskName: 'task one',
    });

    writeFileSync(join(attempt.worktreePath, 'agent.txt'), 'done');
    expect(await statusPorcelain(attempt.worktreePath)).toContain('agent.txt');

    await manager.cleanup(attempt.worktreePath, attempt.branchName);

    const { execGit } = await import('@/git/git');
    const list = await execGit(repoPath, ['worktree', 'list', '--porcelain']);
    expect(list.stdout).not.toContain(attempt.worktreePath);
  });

  test('cleanup can keep branch when requested', async () => {
    const { repoPath, worktreesRoot } = await createRepo();
    const manager = new WorkspaceManager(worktreesRoot);

    const attempt = await manager.prepareAttempt({
      repoPath,
      baseBranch: 'main',
      runId: '01JXYZABCDEFGHJKMNPQRSTVWX',
      taskName: 'keep-branch',
    });

    await manager.cleanup(attempt.worktreePath, attempt.branchName, {
      keepBranch: true,
    });

    const { branchExists } = await import('@/git/git');
    expect(await branchExists(repoPath, attempt.branchName)).toBe(true);
  });
});
