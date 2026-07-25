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
  fetchAndFastForwardBranch,
  getBranch,
  getHead,
  GitError,
  initRepo,
  isRepo,
  removeWorktree,
  resolveRemoteTrackingRef,
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

  test('fetchAndFastForwardBranch is best-effort when checked-out branch is dirty', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-git-ff-'));
    const barePath = join(tempDir, 'remote.git');
    const seed = join(tempDir, 'seed');
    const repo = join(tempDir, 'repo');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(seed, { recursive: true });

    await initRepo(seed);
    await configLocal(seed, 'user.email', 'test@example.com');
    await configLocal(seed, 'user.name', 'Gojo Test');
    writeFileSync(join(seed, 'README.md'), '# a\n');
    await commitAll(seed, 'initial');
    await execGit(tempDir, ['clone', '--bare', seed, barePath]);
    await execGit(tempDir, ['clone', barePath, repo]);
    await configLocal(repo, 'user.email', 'test@example.com');
    await configLocal(repo, 'user.name', 'Gojo Test');

    const pusher = join(tempDir, 'pusher');
    await execGit(tempDir, ['clone', barePath, pusher]);
    await configLocal(pusher, 'user.email', 'test@example.com');
    await configLocal(pusher, 'user.name', 'Gojo Test');
    writeFileSync(join(pusher, 'README.md'), '# remote\n');
    await commitAll(pusher, 'advance');
    await execGit(pusher, ['push', 'origin', 'main']);
    const remoteSha = (await execGit(pusher, ['rev-parse', 'HEAD'])).stdout;

    writeFileSync(join(repo, 'README.md'), '# dirty local\n');

    await expect(fetchAndFastForwardBranch(repo, 'main')).resolves.toBeUndefined();
    expect(await resolveRemoteTrackingRef(repo, 'main')).toBe(remoteSha);
    // Local working tree left alone.
    expect(await statusPorcelain(repo)).toContain('README.md');
  });
});
