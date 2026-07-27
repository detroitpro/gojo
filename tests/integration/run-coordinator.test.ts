import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setSchedulingPolicy } from '@/app/instance-settings';
import { resolvePaths } from '@/config/paths';
import { commitAll, configLocal, execGit, initRepo } from '@/git/git';
import { RunState } from '@shared/run-states';
import { RunCoordinator } from '@/runs/coordinator';
import { RunDispatcher } from '@/runs/dispatcher';
import { Database, createRepositories, createWorkRepositories } from '@/storage';
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
    database: Database;
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

    return { coordinator, database: db, repos, repoPath, paths, project, task };
  }

  test('full flow: shell task, validation, commit-only, succeeded', async () => {
    const { coordinator, database, repos, repoPath, paths, project, task } = await setup();

    const run = await coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      trigger: 'manual',
    });

    expect(run.state).toBe(RunState.Queued);
    expect(run.workItemId).not.toBeNull();
    const work = createWorkRepositories(database);
    expect(work.runContexts.findByRun(run.id)).toMatchObject({
      workItemId: run.workItemId,
      taskName: "create-file",
      prompt: task.prompt,
      baseBranch: "main",
    });

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
    expect(work.items.findById(run.workItemId ?? "")).toMatchObject({
      execution: "terminal",
      outcome: "succeeded",
    });
    expect(work.events.listByWorkItem(run.workItemId ?? "").map((event) => event.type)).toEqual(
      expect.arrayContaining(["run.created", "run.state_changed", "run.finished"]),
    );
    expect(
      database
        .connection()
        .query<{ count: number }, [string]>(
          `SELECT COUNT(*) AS count FROM validations v
           JOIN attempts a ON a.id = v.attempt_id WHERE a.run_id = ?`,
        )
        .get(run.id)?.count,
    ).toBe(1);
    expect(
      database
        .connection()
        .query<{ path: string }, [string]>(
          "SELECT path FROM artifacts WHERE run_id = ? AND kind = 'handoff'",
        )
        .get(run.id)?.path,
    ).toBe(handoffPath);
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

  test('schedule-triggered run transitions Scheduled → Queued → Preparing and succeeds', async () => {
    const { coordinator, repos, project, task } = await setup();

    const run = await coordinator.createRun({
      projectId: project.id,
      taskId: task.id,
      trigger: 'schedule',
      idempotencyKey: 'sched:fire-1',
    });

    expect(run.state).toBe(RunState.Scheduled);

    const finished = await coordinator.executeRun(run.id);
    expect(finished.state).toBe(RunState.Succeeded);
    expect(finished.errorMessage).toBeNull();
    expect(finished.startedAt).not.toBeNull();

    const stored = repos.runs.findById(run.id);
    expect(stored?.state).toBe(RunState.Succeeded);
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

  test('dispatcher never exceeds maxConcurrentRuns of 2 across five projects', async () => {
    db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    setSchedulingPolicy(db, {
      maxConcurrentRuns: 2,
      maxConcurrentRunsPerProject: 1,
      minStartIntervalMs: 0,
      maxLoadPerCpu: 0,
    });

    let peakConcurrent = 0;
    let inFlight = 0;
    const admitOrder: string[] = [];

    const coordinator = {
      executeRun: async (runId: string) => {
        inFlight += 1;
        peakConcurrent = Math.max(peakConcurrent, inFlight);
        admitOrder.push(runId);
        repos.runs.update(runId, {
          state: RunState.Running,
          startedAt: new Date().toISOString(),
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        repos.runs.update(runId, {
          state: RunState.Succeeded,
          finishedAt: new Date().toISOString(),
        });
        inFlight -= 1;
        return repos.runs.findById(runId)!;
      },
    } as unknown as RunCoordinator;

    const runIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const project = repos.projects.create({
        name: `proj-${i}`,
        repoPath: `/tmp/proj-${i}`,
      });
      const task = repos.tasks.create({
        projectId: project.id,
        name: `task-${i}`,
        prompt: 'go',
      });
      const run = repos.runs.create({
        projectId: project.id,
        taskId: task.id,
        idempotencyKey: `sched-${i}`,
        trigger: 'schedule',
        priority: 30 - i, // lower number = higher priority; drain high-priority first
        notBeforeAt: '2026-07-26T00:00:00.000Z',
      });
      runIds.push(run.id);
    }

    const dispatcher = new RunDispatcher({
      db,
      coordinator,
      loadPerCpu: () => 0,
      now: () => new Date('2026-07-26T12:00:00.000Z'),
    });

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await dispatcher.tick();
      const terminal = runIds.every((id) => repos.runs.findById(id)?.state === RunState.Succeeded);
      if (terminal) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(peakConcurrent).toBeLessThanOrEqual(2);
    expect(peakConcurrent).toBe(2);
    expect(admitOrder).toHaveLength(5);
    // priority 26..30 → admit 4,3,2,1,0 (ids in that priority order)
    expect(admitOrder[0]).toBe(runIds[4]);
    expect(admitOrder[1]).toBe(runIds[3]);
    expect(runIds.every((id) => repos.runs.findById(id)?.state === RunState.Succeeded)).toBe(true);
  });
});
