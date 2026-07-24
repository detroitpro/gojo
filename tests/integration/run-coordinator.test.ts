import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolvePaths } from '@/config/paths';
import { commitAll, configLocal, execGit, initRepo } from '@/git/git';
import { RunState } from '@shared/run-states';
import { RunCoordinator } from '@/runs/coordinator';
import { Database, createRepositories } from '@/storage';
import type { Project, Task } from '@/storage/types';
import { WorkspaceManager } from '@/workspace/manager';

describe('integration/run-coordinator', () => {
  let tempDir: string | null = null;
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function setup(): Promise<{
    coordinator: RunCoordinator;
    repos: ReturnType<typeof createRepositories>;
    repoPath: string;
    paths: ReturnType<typeof resolvePaths>;
    project: Project;
    task: Task;
  }> {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-run-coordinator-test-'));
    const paths = resolvePaths(tempDir);
    const repoPath = join(tempDir, 'repo');
    const worktreesRoot = join(tempDir, 'worktrees');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(repoPath, { recursive: true });

    await initRepo(repoPath);
    await configLocal(repoPath, 'user.email', 'test@example.com');
    await configLocal(repoPath, 'user.name', 'Gojo Test');
    writeFileSync(join(repoPath, 'README.md'), '# coordinator test\n');
    await commitAll(repoPath, 'initial commit');

    db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);

    const project = repos.projects.create({
      name: 'demo',
      repoPath,
      defaultBranch: 'main',
    });

    const task = repos.tasks.create({
      projectId: project.id,
      name: 'create-file',
      prompt: [
        '#!/bin/sh',
        'set -eu',
        'echo "agent output" > agent-result.txt',
      ].join('\n'),
      validationProfileJson: JSON.stringify({
        steps: [{ name: 'file-exists', command: 'test -f agent-result.txt' }],
      }),
      integrationJson: JSON.stringify({
        mode: 'commit-only',
        targetBranch: 'main',
        commitMessage: 'gojo: add agent-result.txt',
      }),
    });

    const coordinator = new RunCoordinator({
      db,
      paths,
      workspace: new WorkspaceManager(worktreesRoot),
    });

    return { coordinator, repos, repoPath, paths, project, task };
  }

  test('full flow: shell task, validation, commit-only, succeeded', async () => {
    const { coordinator, repos, repoPath, paths, project, task } = await setup();

    const run = await coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      trigger: 'manual',
    });

    expect(run.state).toBe(RunState.Queued);

    const finished = await coordinator.executeRun(run.id);
    expect(finished.state).toBe(RunState.Succeeded);
    expect(finished.finishedAt).not.toBeNull();

    const attempts = repos.attempts.listByRun(run.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.resultCommit).toMatch(/^[0-9a-f]{40}$/);

    const cat = await execGit(repoPath, [
      'cat-file',
      '-t',
      attempts[0]!.resultCommit!,
    ]);
    expect(cat.exitCode).toBe(0);
    expect(cat.stdout).toBe('commit');

    const handoffPath = join(paths.artifacts, run.id, 'handoff.json');
    expect(existsSync(handoffPath)).toBe(true);
    const handoff = JSON.parse(readFileSync(handoffPath, 'utf8')) as {
      runId: string;
      status: string;
    };
    expect(handoff.runId).toBe(run.id);
    expect(handoff.status).toBe('completed');
  });

  test('scheduled run transitions Scheduled -> Queued -> Preparing before executing', async () => {
    const { coordinator, repos, project, task } = await setup();

    const run = await coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      trigger: 'schedule',
      idempotencyKey: 'schedule-fire',
    });

    expect(run.state).toBe(RunState.Scheduled);

    const finished = await coordinator.executeRun(run.id);
    expect(finished.state).toBe(RunState.Succeeded);

    const attempts = repos.attempts.listByRun(run.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.state).toBe('succeeded');
  });

  test('validation failure writes artifact and rich errorMessage', async () => {
    const { coordinator, repos, paths, project } = await setup();

    const task = repos.tasks.create({
      projectId: project.id,
      name: 'always-fail-validation',
      prompt: [
        '#!/bin/sh',
        'set -eu',
        'echo ok > agent-result.txt',
      ].join('\n'),
      validationProfileJson: JSON.stringify({
        steps: [
          {
            name: 'must-fail',
            command: 'echo "boom validation" >&2; exit 7',
          },
        ],
      }),
      integrationJson: JSON.stringify({ mode: 'none' }),
    });

    const run = await coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      trigger: 'manual',
    });

    const finished = await coordinator.executeRun(run.id);
    expect(finished.state).toBe(RunState.Failed);
    expect(finished.errorMessage).toContain('Validation failed: must-fail');
    expect(finished.errorMessage).toContain('exit 7');
    expect(finished.errorMessage).toContain('boom validation');

    const validationPath = join(paths.artifacts, run.id, 'validation.json');
    expect(existsSync(validationPath)).toBe(true);
    const validation = JSON.parse(readFileSync(validationPath, 'utf8')) as {
      passed: boolean;
      steps: Array<{ name: string; exitCode: number | null; status: string }>;
    };
    expect(validation.passed).toBe(false);
    expect(validation.steps[0]?.name).toBe('must-fail');
    expect(validation.steps[0]?.status).toBe('failed');
    expect(validation.steps[0]?.exitCode).toBe(7);
  });

  test('createRun is idempotent by key', async () => {
    const { coordinator, project, task } = await setup();

    const first = await coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      trigger: 'manual',
      idempotencyKey: 'same-key',
    });

    const second = await coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      trigger: 'manual',
      idempotencyKey: 'same-key',
    });

    expect(second.id).toBe(first.id);
  });

  test('recoverInterrupted abandons stuck running runs', async () => {
    const { coordinator, repos, project, task } = await setup();

    const run = repos.runs.create({
      projectId: project.id,
      taskId: task.id,
      idempotencyKey: 'stuck-run',
      trigger: 'manual',
      state: RunState.Running,
    });

    const recovered = await coordinator.recoverInterrupted();
    expect(recovered).toBe(1);

    const updated = repos.runs.findById(run.id);
    expect(updated?.state).toBe(RunState.Abandoned);
  });
});
