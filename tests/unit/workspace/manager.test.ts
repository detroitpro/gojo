import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  commitAll,
  configLocal,
  execGit,
  getHead,
  initRepo,
  statusPorcelain,
} from '@/git/git';
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
    mkdirSync(repoPath, { recursive: true });

    await initRepo(repoPath);
    await configLocal(repoPath, 'user.email', 'test@example.com');
    await configLocal(repoPath, 'user.name', 'Gojo Test');
    writeFileSync(join(repoPath, 'README.md'), '# workspace test\n');
    await commitAll(repoPath, 'initial commit');

    return { repoPath, worktreesRoot };
  }

  /** Clone with a dirty checked-out main while origin/main has advanced. */
  async function createDirtyCloneWithRemote(): Promise<{
    repoPath: string;
    worktreesRoot: string;
    remoteMainSha: string;
  }> {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-workspace-dirty-'));
    const barePath = join(tempDir, 'remote.git');
    const repoPath = join(tempDir, 'repo');
    const worktreesRoot = join(tempDir, 'worktrees');
    const seedPath = join(tempDir, 'seed');

    mkdirSync(seedPath, { recursive: true });
    await initRepo(seedPath);
    await configLocal(seedPath, 'user.email', 'test@example.com');
    await configLocal(seedPath, 'user.name', 'Gojo Test');
    writeFileSync(join(seedPath, 'README.md'), '# seed\n');
    writeFileSync(join(seedPath, 'tracked.txt'), 'v1\n');
    await commitAll(seedPath, 'initial');

    await execGit(tempDir, ['clone', '--bare', seedPath, barePath]);
    await execGit(tempDir, ['clone', barePath, repoPath]);
    await configLocal(repoPath, 'user.email', 'test@example.com');
    await configLocal(repoPath, 'user.name', 'Gojo Test');

    // Advance origin/main via a second clone.
    const pusher = join(tempDir, 'pusher');
    await execGit(tempDir, ['clone', barePath, pusher]);
    await configLocal(pusher, 'user.email', 'test@example.com');
    await configLocal(pusher, 'user.name', 'Gojo Test');
    writeFileSync(join(pusher, 'tracked.txt'), 'v2-remote\n');
    writeFileSync(join(pusher, 'new-on-remote.txt'), 'from remote\n');
    await commitAll(pusher, 'remote advance');
    await execGit(pusher, ['push', 'origin', 'main']);
    const remoteMainSha = (await execGit(pusher, ['rev-parse', 'HEAD'])).stdout;

    // Dirty the primary checkout in ways that block merge --ff-only.
    writeFileSync(join(repoPath, 'tracked.txt'), 'local dirty\n');
    writeFileSync(join(repoPath, 'new-on-remote.txt'), 'local untracked collide\n');

    return { repoPath, worktreesRoot, remoteMainSha };
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

  test('prepareAttempt with syncBeforeRun succeeds on dirty primary checkout', async () => {
    const { repoPath, worktreesRoot, remoteMainSha } =
      await createDirtyCloneWithRemote();
    const manager = new WorkspaceManager(worktreesRoot);

    const attempt = await manager.prepareAttempt({
      repoPath,
      baseBranch: 'main',
      runId: '01JXYZABCDEFGHJKMNPQRSTVWX',
      taskName: 'deps-python',
      syncBeforeRun: true,
    });

    expect(attempt.startingCommit).toBe(remoteMainSha);
    const worktreeHead = (await execGit(attempt.worktreePath, ['rev-parse', 'HEAD']))
      .stdout;
    expect(worktreeHead).toBe(remoteMainSha);
    // Primary checkout stays dirty — gojo must not require cleaning it.
    expect(await statusPorcelain(repoPath)).toContain('tracked.txt');
  });
});
