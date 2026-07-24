import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addWorktree,
  commitAll,
  configLocal,
  createBranch,
  createOrphanSafe,
  diffNameOnly,
  execGit,
  getBranch,
  getHead,
  GitError,
  initRepo,
  isRepo,
  removeWorktree,
  statusPorcelain,
} from '@/git/git';

describe('git/git', () => {
  let tempDir: string | null = null;
  let repoPath: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
      repoPath = null;
    }
  });

  async function createTempRepo(): Promise<string> {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-git-test-'));
    repoPath = join(tempDir, 'repo');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(repoPath, { recursive: true });
    await initRepo(repoPath);
    await configLocal(repoPath, 'user.email', 'test@example.com');
    await configLocal(repoPath, 'user.name', 'Gojo Test');
    writeFileSync(join(repoPath, 'README.md'), '# test\n');
    await commitAll(repoPath, 'initial commit');
    return repoPath;
  }

  test('execGit returns stdout, stderr, and exitCode', async () => {
    const repo = await createTempRepo();
    const result = await execGit(repo, ['rev-parse', 'HEAD']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test('isRepo detects git repositories', async () => {
    const repo = await createTempRepo();
    expect(await isRepo(repo)).toBe(true);
    expect(await isRepo(tmpdir())).toBe(false);
  });

  test('getHead and getBranch return current state', async () => {
    const repo = await createTempRepo();
    const head = await getHead(repo);
    const branch = await getBranch(repo);

    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(branch).toBe('main');
  });

  test('createBranch, worktree, status, diff, and cleanup', async () => {
    const repo = await createTempRepo();
    const head = await getHead(repo);
    const branchName = 'gojo/test-branch';
    const worktreePath = join(tempDir!, 'worktree');

    await createBranch(repo, branchName, head);
    await addWorktree(repo, worktreePath, branchName);

    writeFileSync(join(worktreePath, 'change.txt'), 'hello');
    expect(await statusPorcelain(worktreePath)).toContain('change.txt');
    expect(await diffNameOnly(worktreePath)).toContain('change.txt');

    await removeWorktree(repo, worktreePath);
    const list = await execGit(repo, ['worktree', 'list', '--porcelain']);
    expect(list.stdout).not.toContain(worktreePath);
  });

  test('createOrphanSafe creates orphan branch once', async () => {
    const repo = await createTempRepo();
    const orphanBranch = 'gojo/orphan';

    await createOrphanSafe(repo, orphanBranch);
    await createOrphanSafe(repo, orphanBranch);

    const branch = await getBranch(repo);
    expect(branch).toBe(orphanBranch);
  });

  test('throws GitError on failure', async () => {
    const repo = await createTempRepo();

    await expect(getBranch(join(repo, 'missing'))).rejects.toBeInstanceOf(
      GitError,
    );

    await expect(
      createBranch(repo, 'invalid branch name', 'HEAD'),
    ).rejects.toBeInstanceOf(GitError);
  });
});
