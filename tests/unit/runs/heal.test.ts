import { describe, expect, test } from 'bun:test';

import { decideHealEnqueue } from '@/runs/heal';
import { Database, createRepositories } from '@/storage';
import { RunState } from '@shared/run-states';

describe('decideHealEnqueue', () => {
  test('enqueues healer after failed run when configured', () => {
    const db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({
      name: 'demo',
      repoPath: '/tmp/demo',
    });
    const failing = repos.tasks.create({
      projectId: project.id,
      name: 'deps',
      prompt: 'do work',
      failurePolicyJson: JSON.stringify({
        selfHeal: { task: 'self-heal', afterConsecutiveFailedRuns: 1 },
      }),
    });
    const healer = repos.tasks.create({
      projectId: project.id,
      name: 'self-heal',
      prompt: 'heal',
    });
    const run = repos.runs.create({
      projectId: project.id,
      taskId: failing.id,
      idempotencyKey: 'k1',
      trigger: 'manual',
      state: RunState.Failed,
    });

    const decision = decideHealEnqueue({
      db,
      failedRun: run,
      failedTask: failing,
      policy: {
        selfHeal: { task: 'self-heal', afterConsecutiveFailedRuns: 1 },
      },
    });

    expect(decision.shouldEnqueue).toBe(true);
    expect(decision.healerTaskId).toBe(healer.id);
    db.close();
  });

  test('does not enqueue when failing task is the healer', () => {
    const db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({
      name: 'demo',
      repoPath: '/tmp/demo',
    });
    const healer = repos.tasks.create({
      projectId: project.id,
      name: 'self-heal',
      prompt: 'heal',
      failurePolicyJson: JSON.stringify({
        selfHeal: { task: 'self-heal' },
      }),
    });
    const run = repos.runs.create({
      projectId: project.id,
      taskId: healer.id,
      idempotencyKey: 'k2',
      trigger: 'manual',
      state: RunState.Failed,
    });

    const decision = decideHealEnqueue({
      db,
      failedRun: run,
      failedTask: healer,
      policy: { selfHeal: { task: 'self-heal' } },
    });

    expect(decision.shouldEnqueue).toBe(false);
    expect(decision.reason).toContain('excluded');
    db.close();
  });

  test('does not enqueue for heal-triggered runs', () => {
    const db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({
      name: 'demo',
      repoPath: '/tmp/demo',
    });
    const failing = repos.tasks.create({
      projectId: project.id,
      name: 'deps',
      prompt: 'do work',
    });
    repos.tasks.create({
      projectId: project.id,
      name: 'self-heal',
      prompt: 'heal',
    });
    const run = repos.runs.create({
      projectId: project.id,
      taskId: failing.id,
      idempotencyKey: 'k3',
      trigger: 'heal',
      state: RunState.Failed,
    });

    const decision = decideHealEnqueue({
      db,
      failedRun: run,
      failedTask: failing,
      policy: { selfHeal: { task: 'self-heal' } },
    });

    expect(decision.shouldEnqueue).toBe(false);
    expect(decision.reason).toContain('re-trigger');
    db.close();
  });
});
