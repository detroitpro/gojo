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

  test('result commit excludes the handoff file', async () => {
    const { repoPath, worktreePath, branchName } = await createRepo();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(worktreePath, '.gojo'), { recursive: true });
    writeFileSync(join(worktreePath, '.gojo', 'handoff.json'), '{"status":"success"}');
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

    const committed = await execGit(worktreePath, [
      'show',
      '--name-only',
      '--pretty=format:',
      result.commitSha!,
    ]);
    expect(committed.stdout).toContain('agent-output.txt');
    expect(committed.stdout).not.toContain('handoff.json');
  });

  test('handoff-only change is treated as no diff so no PR is opened', async () => {
    const { repoPath, worktreePath, branchName } = await createRepo();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(worktreePath, '.gojo'), { recursive: true });
    writeFileSync(
      join(worktreePath, '.gojo', 'handoff.json'),
      '{"status":"success","summary":"diagnose only"}',
    );

    const result = await integrate({
      mode: 'pull-request',
      projectId: 'project-1',
      worktreePath,
      repoPath,
      targetBranch: 'main',
      branchName,
      commitMessage: 'gojo: diagnose only',
      runId: 'run-diagnose',
      prTool: 'gh',
    });

    expect(result.commitSha).toBeNull();
    expect(result.prUrl).toBeNull();
    expect(result.prCreated).toBeNull();
  });

  test('pull-request skips push and PR when worktree is clean', async () => {
    const { repoPath, worktreePath, branchName } = await createRepo();

    const result = await integrate({
      mode: 'pull-request',
      projectId: 'project-1',
      worktreePath,
      repoPath,
      targetBranch: 'main',
      branchName,
      commitMessage: 'gojo: no changes',
      runId: 'run-clean',
      prTool: 'gh',
    });

    expect(result.commitSha).toBeNull();
    expect(result.prUrl).toBeNull();
    expect(result.prCreated).toBeNull();
    expect(result.conflict).toBe(false);
  });

  test('pull-request returns placeholder when PR CLI cannot create a PR', async () => {
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
      prTool: 'gh',
    });

    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    // No GitHub remote / auth in the temp repo — create fails → placeholder.
    expect(result.prUrl).toBe(`local://pr/${branchName}`);
    expect(result.prCreated).toBe(false);
  });

  test('pull-request with prTool tea returns placeholder when create fails', async () => {
    const { repoPath, worktreePath, branchName } = await createRepo();
    writeFileSync(join(worktreePath, 'pr-tea.txt'), 'pr');

    const result = await integrate({
      mode: 'pull-request',
      projectId: 'project-1',
      worktreePath,
      repoPath,
      targetBranch: 'main',
      branchName,
      commitMessage: 'gojo: tea pr test',
      runId: 'run-tea',
      prTool: 'tea',
      prLogin: 'home',
      prRemote: 'origin',
    });

    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.prUrl).toBe(`local://pr/${branchName}`);
    expect(result.prCreated).toBe(false);
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

  test('auto-merge reports conflict when merge fails', async () => {
    const { repoPath, worktreePath, branchName } = await createRepo();
    writeFileSync(join(repoPath, 'conflict.txt'), 'main version\n');
    await commitAll(repoPath, 'main side');
    writeFileSync(join(worktreePath, 'conflict.txt'), 'branch version\n');

    const queue = new MergeQueue();
    const result = await integrate({
      mode: 'auto-merge',
      projectId: 'project-1',
      worktreePath,
      repoPath,
      targetBranch: 'main',
      branchName,
      commitMessage: 'gojo: branch side',
      runId: 'run-conflict',
      mergeQueue: queue,
    });

    expect(result.conflict).toBe(true);
    expect(result.prUrl).toBeNull();
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
