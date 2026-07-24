import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolvePaths } from '@/config/paths';
import { commitAll, configLocal, initRepo } from '@/git/git';
import { RunCoordinator } from '@/runs/coordinator';
import { RunState } from '@shared/run-states';
import { Database, createRepositories } from '@/storage';
import { WorkspaceManager } from '@/workspace/manager';

describe('maxAttemptsPerRun', () => {
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

  test('retries agent failure under the same run', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-max-attempts-'));
    const paths = resolvePaths(tempDir);
    const repoPath = join(tempDir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    await initRepo(repoPath);
    await configLocal(repoPath, 'user.email', 'test@example.com');
    await configLocal(repoPath, 'user.name', 'Gojo Test');
    writeFileSync(join(repoPath, 'README.md'), '# test\n');
    await commitAll(repoPath, 'initial');

    db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({
      name: 'demo',
      repoPath,
      defaultBranch: 'main',
    });

    // Fail twice then succeed on attempt 3 via a counter file outside the worktree.
    const counterPath = join(tempDir, 'counter');
    writeFileSync(counterPath, '0');
    const task = repos.tasks.create({
      projectId: project.id,
      name: 'flaky',
      prompt: [
        '#!/bin/sh',
        'set -eu',
        `n=$(cat "${counterPath}")`,
        `n=$((n + 1))`,
        `echo "$n" > "${counterPath}"`,
        'if [ "$n" -lt 3 ]; then exit 1; fi',
        'echo ok > done.txt',
      ].join('\n'),
      validationProfileJson: JSON.stringify({
        steps: [{ name: 'done', command: 'test -f done.txt' }],
      }),
      failurePolicyJson: JSON.stringify({
        maxAttemptsPerRun: 3,
        backoff: 'none',
      }),
      integrationJson: JSON.stringify({ mode: 'none' }),
    });

    const coordinator = new RunCoordinator({
      db,
      paths,
      workspace: new WorkspaceManager(join(tempDir, 'worktrees')),
    });

    const run = await coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      trigger: 'manual',
    });
    const finished = await coordinator.executeRun(run.id);
    expect(finished.state).toBe(RunState.Succeeded);

    const attempts = repos.attempts.listByRun(run.id);
    expect(attempts).toHaveLength(3);
    expect(attempts.filter((a) => a.state === 'failed')).toHaveLength(2);
    expect(attempts.filter((a) => a.state === 'succeeded')).toHaveLength(1);
  });
});
