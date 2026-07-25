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
    const created = repos.runs.create({
      projectId: project.id,
      taskId: failing.id,
      idempotencyKey: 'k1',
      trigger: 'manual',
      state: RunState.Failed,
    });
    const run =
      repos.runs.update(created.id, {
        startedAt: new Date().toISOString(),
        errorMessage: 'Agent exited with code 1',
      }) ?? created;

    const decision = decideHealEnqueue({
      repos,
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
    const created = repos.runs.create({
      projectId: project.id,
      taskId: healer.id,
      idempotencyKey: 'k2',
      trigger: 'manual',
      state: RunState.Failed,
    });
    const run =
      repos.runs.update(created.id, {
        startedAt: new Date().toISOString(),
        errorMessage: 'Agent exited with code 1',
      }) ?? created;

    const decision = decideHealEnqueue({
      repos,
      failedRun: run,
      failedTask: healer,
      policy: { selfHeal: { task: 'self-heal' } },
    });

    expect(decision.shouldEnqueue).toBe(false);
    expect(decision.reason).toContain('excluded');
    db.close();
  });

  test('does not enqueue when healer task is missing or below failure threshold', () => {
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
    const created = repos.runs.create({
      projectId: project.id,
      taskId: failing.id,
      idempotencyKey: 'k4',
      trigger: 'manual',
      state: RunState.Failed,
    });
    const run =
      repos.runs.update(created.id, {
        startedAt: new Date().toISOString(),
        errorMessage: 'Agent exited with code 1',
      }) ?? created;

    const missingHealer = decideHealEnqueue({
      repos,
      failedRun: run,
      failedTask: failing,
      policy: { selfHeal: { task: 'self-heal', afterConsecutiveFailedRuns: 2 } },
    });
    expect(missingHealer.shouldEnqueue).toBe(false);
    expect(missingHealer.reason).toContain('not found');

    repos.tasks.create({
      projectId: project.id,
      name: 'self-heal',
      prompt: 'heal',
    });

    const belowThreshold = decideHealEnqueue({
      repos,
      failedRun: run,
      failedTask: failing,
      policy: { selfHeal: { task: 'self-heal', afterConsecutiveFailedRuns: 2 } },
    });
    expect(belowThreshold.shouldEnqueue).toBe(false);
    expect(belowThreshold.reason).toContain('consecutive failures');

    db.close();
  });

  test('does not enqueue when run never started', () => {
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
    const created = repos.runs.create({
      projectId: project.id,
      taskId: failing.id,
      idempotencyKey: 'k-never-started',
      trigger: 'schedule',
      state: RunState.Failed,
    });
    const run =
      repos.runs.update(created.id, {
        errorMessage: 'Invalid run transition: Scheduled -> Preparing',
      }) ?? created;

    const decision = decideHealEnqueue({
      repos,
      failedRun: run,
      failedTask: failing,
      policy: { selfHeal: { task: 'self-heal' } },
    });

    expect(decision.shouldEnqueue).toBe(false);
    expect(decision.reason).toContain('never started');
    db.close();
  });

  test('does not enqueue for invalid run transition failures', () => {
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
    const created = repos.runs.create({
      projectId: project.id,
      taskId: failing.id,
      idempotencyKey: 'k-bad-transition',
      trigger: 'schedule',
      state: RunState.Failed,
    });
    const run =
      repos.runs.update(created.id, {
        startedAt: new Date().toISOString(),
        errorMessage: 'Invalid run transition: Scheduled -> Preparing',
      }) ?? created;

    const decision = decideHealEnqueue({
      repos,
      failedRun: run,
      failedTask: failing,
      policy: { selfHeal: { task: 'self-heal' } },
    });

    expect(decision.shouldEnqueue).toBe(false);
    expect(decision.reason).toContain('invalid state transition');
    db.close();
  });

  test('does not enqueue when hourly heal cap is reached', () => {
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
    const healer = repos.tasks.create({
      projectId: project.id,
      name: 'self-heal',
      prompt: 'heal',
    });

    for (let i = 0; i < 3; i++) {
      repos.runs.create({
        projectId: project.id,
        taskId: healer.id,
        idempotencyKey: `heal-cap-${i}`,
        trigger: 'heal',
        state: RunState.Succeeded,
      });
    }

    const created = repos.runs.create({
      projectId: project.id,
      taskId: failing.id,
      idempotencyKey: 'heal-cap-fail',
      trigger: 'manual',
      state: RunState.Failed,
    });
    const run =
      repos.runs.update(created.id, {
        startedAt: new Date().toISOString(),
        errorMessage: 'Agent exited with code 1',
      }) ?? created;

    const decision = decideHealEnqueue({
      repos,
      failedRun: run,
      failedTask: failing,
      policy: { selfHeal: { task: 'self-heal', afterConsecutiveFailedRuns: 1 } },
    });

    expect(decision.shouldEnqueue).toBe(false);
    expect(decision.reason).toContain('heal cap reached');
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
    const created = repos.runs.create({
      projectId: project.id,
      taskId: failing.id,
      idempotencyKey: 'k3',
      trigger: 'heal',
      state: RunState.Failed,
    });
    const run =
      repos.runs.update(created.id, {
        startedAt: new Date().toISOString(),
        errorMessage: 'Agent exited with code 1',
      }) ?? created;

    const decision = decideHealEnqueue({
      repos,
      failedRun: run,
      failedTask: failing,
      policy: { selfHeal: { task: 'self-heal' } },
    });

    expect(decision.shouldEnqueue).toBe(false);
    expect(decision.reason).toContain('re-trigger');
    db.close();
  });
});
