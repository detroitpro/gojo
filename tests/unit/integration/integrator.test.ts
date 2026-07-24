import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { integrate } from '@/integration/integrator';
import { MergeQueue } from '@/integration/queue';

describe('integration/integrator', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function createRepo(): Promise<{
    repoPath: string;
    worktreePath: string;
    branchName: string;
  }> {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-integrator-test-'));
    const repoPath = join(tempDir, 'repo');
    const worktreePath = join(tempDir, 'worktree');
    const branchName = 'gojo/test/run-abc';
    const { mkdirSync } = await import('node:fs');
    mkdirSync(repoPath, { recursive: true });

    await initRepo(repoPath);
    await configLocal(repoPath, 'user.email', 'test@example.com');
    await configLocal(repoPath, 'user.name', 'Gojo Test');
    writeFileSync(join(repoPath, 'README.md'), '# integrator\n');
    await commitAll(repoPath, 'initial');

    await execGit(repoPath, ['branch', branchName, 'main']);
    await execGit(repoPath, ['worktree', 'add', worktreePath, branchName]);

    return { repoPath, worktreePath, branchName };
  }

  test('none mode does not commit', async () => {
    const { repoPath, worktreePath, branchName } = await createRepo();
    writeFileSync(join(worktreePath, 'change.txt'), 'hello');

    const result = await integrate({
      mode: 'none',
      projectId: 'project-1',
      worktreePath,
      repoPath,
      targetBranch: 'main',
      branchName,
      commitMessage: 'ignored',
      runId: 'run-1',
    });

    expect(result.commitSha).toBeNull();
    expect(result.conflict).toBe(false);
    expect(await statusPorcelain(worktreePath)).toContain('change.txt');
  });

  test('commit-only commits dirty worktree', async () => {
    const { repoPath, worktreePath, branchName } = await createRepo();
    writeFileSync(join(worktreePath, 'agent-output.txt'), 'done');

    const result = await integrate({
      mode: 'commit-only',
      projectId: 'project-1',
      worktreePath,
      repoPath,
      targetBranch: 'main',
      branchName,
      commitMessage: 'gojo: test commit',
      runId: 'run-1',
    });

    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(await statusPorcelain(worktreePath)).toBe('');
    expect(await getHead(worktreePath)).toBe(result.commitSha!);
  });

  test('pull-request returns placeholder when gh is unavailable', async () => {
    const { repoPath, worktreePath, branchName } = await createRepo();
    writeFileSync(join(worktreePath, 'pr.txt'), 'pr');

    const result = await integrate({
      mode: 'pull-request',
      projectId: 'project-1',
      worktreePath,
      repoPath,
      targetBranch: 'main',
      branchName,
      commitMessage: 'gojo: pr test',
      runId: 'run-1',
    });

    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.prUrl).toBe(`local://pr/${branchName}`);
  });

  test('auto-merge merges branch into target', async () => {
    const { repoPath, worktreePath, branchName } = await createRepo();
    writeFileSync(join(worktreePath, 'merged.txt'), 'merged');

    const queue = new MergeQueue();
    const result = await integrate({
      mode: 'auto-merge',
      projectId: 'project-1',
      worktreePath,
      repoPath,
      targetBranch: 'main',
      branchName,
      commitMessage: 'gojo: merge test',
      runId: 'run-1',
      mergeQueue: queue,
    });

    expect(result.conflict).toBe(false);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);

    const mainHead = await getHead(repoPath);
    expect(mainHead).toBe(result.commitSha!);

    const show = await execGit(repoPath, ['show', '--name-only', '--pretty=format:', mainHead]);
    expect(show.stdout).toContain('merged.txt');
  });

  test('await-approval commits without merging', async () => {
    const { repoPath, worktreePath, branchName } = await createRepo();
    writeFileSync(join(worktreePath, 'approval.txt'), 'needs approval');

    const result = await integrate({
      mode: 'await-approval',
      projectId: 'project-1',
      worktreePath,
      repoPath,
      targetBranch: 'main',
      branchName,
      commitMessage: 'gojo: approval test',
      runId: 'run-1',
    });

    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(await getHead(repoPath)).not.toBe(result.commitSha);
  });
});
