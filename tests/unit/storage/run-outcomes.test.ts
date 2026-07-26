import { describe, expect, test } from 'bun:test';

import { Database, createRepositories } from '@/storage';
import { SCHEMA_MIGRATIONS } from '@/storage/schema';

function seedRun(repos: ReturnType<typeof createRepositories>) {
  const project = repos.projects.create({ name: 'p', repoPath: '/tmp/p' });
  const task = repos.tasks.create({ projectId: project.id, name: 't', prompt: 'x' });
  const run = repos.runs.create({
    projectId: project.id,
    taskId: task.id,
    idempotencyKey: `k-${Math.random()}`,
    trigger: 'manual',
  });
  const attempt = repos.attempts.create({ runId: run.id, attemptNumber: 1 });
  return { project, task, run, attempt };
}

describe('storage/run-outcomes', () => {
  test('migration v4 creates outcome tables on existing v3 databases', () => {
    const db = Database.open(':memory:');
    // Simulate an existing v3 DB: apply DDL then force version 3.
    db.migrate();
    db.connection().query('DELETE FROM schema_migrations').run();
    db.connection()
      .query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(3, new Date().toISOString());
    db.connection().query('DROP TABLE run_impact_items').run();
    db.connection().query('DROP TABLE run_integrations').run();

    db.migrate();
    expect(db.hasExpectedTables()).toBe(true);
    expect(SCHEMA_MIGRATIONS.some((m) => m.version === 4)).toBe(true);
    db.close();
  });

  test('replaceForRun is idempotent and enforces one item per category/subject', () => {
    const db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const { run, attempt } = seedRun(repos);

    const first = repos.runImpactItems.replaceForRun(run.id, attempt.id, [
      {
        category: 'dependency-update',
        subject: 'package.json',
        summary: 'bumped',
        source: 'platform',
        verification: 'verified',
      },
      {
        category: 'dependency-update',
        subject: 'package.json',
        summary: 'duplicate',
        source: 'agent',
        verification: 'claimed',
      },
      {
        category: 'bug-fix',
        subject: 'issue-1',
        summary: 'fixed',
        source: 'agent',
        verification: 'claimed',
        confidence: 0.7,
        evidenceJson: JSON.stringify({ files: ['src/a.ts'] }),
      },
    ]);
    expect(first).toHaveLength(2);

    const again = repos.runImpactItems.replaceForRun(run.id, attempt.id, [
      {
        category: 'bug-fix',
        subject: 'issue-1',
        summary: 'fixed (retry)',
        source: 'agent',
        verification: 'corroborated',
      },
    ]);
    expect(again).toHaveLength(1);
    expect(repos.runImpactItems.listByRun(run.id)).toHaveLength(1);
    expect(repos.runImpactItems.listByRun(run.id)[0]?.verification).toBe('corroborated');
    db.close();
  });

  test('runIntegrations upsert, due listing, and reconciliation updates', () => {
    const db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const { run, attempt } = seedRun(repos);

    const created = repos.runIntegrations.upsertForRun({
      runId: run.id,
      attemptId: attempt.id,
      mode: 'pull-request',
      provider: 'forgejo',
      apiUrl: 'http://forge.local',
      repo: 'me/app',
      prNumber: 7,
      prUrl: 'http://forge.local/me/app/pulls/7',
      status: 'open',
      autoMergeRequested: true,
      openedAt: '2026-07-01T00:00:00.000Z',
      nextCheckAt: '2026-07-01T00:05:00.000Z',
    });
    expect(created.status).toBe('open');
    expect(created.autoMergeRequested).toBe(true);

    // Upsert on the same run replaces status without duplicating the row.
    const upserted = repos.runIntegrations.upsertForRun({
      runId: run.id,
      mode: 'pull-request',
      status: 'open',
      nextCheckAt: '2026-07-01T00:10:00.000Z',
    });
    expect(upserted.id).toBe(created.id);
    expect(upserted.prNumber).toBe(7);

    const due = repos.runIntegrations.listDue('2026-07-01T00:10:00.000Z', 10);
    expect(due).toHaveLength(1);

    const merged = repos.runIntegrations.update(created.id, {
      status: 'merged',
      mergedAt: '2026-07-01T01:00:00.000Z',
      nextCheckAt: null,
      lastCheckedAt: '2026-07-01T01:00:00.000Z',
      checkCount: 3,
    });
    expect(merged?.status).toBe('merged');
    expect(repos.runIntegrations.listDue('2026-07-02T00:00:00.000Z', 10)).toHaveLength(0);
    expect(repos.runIntegrations.findByRun(run.id)?.mergedAt).toBe(
      '2026-07-01T01:00:00.000Z',
    );
    db.close();
  });
});
