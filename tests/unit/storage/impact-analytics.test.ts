import { describe, expect, test } from 'bun:test';

import { RunState } from '@shared/run-states';
import { Database, createRepositories } from '@/storage';
import { getDashboardImpact } from '@/storage/impact-analytics';

function setup() {
  const db = Database.open(':memory:');
  db.migrate();
  const repos = createRepositories(db);
  const project = repos.projects.create({ name: 'alpha', repoPath: '/tmp/alpha' });
  const task = repos.tasks.create({ projectId: project.id, name: 'deps', prompt: 'x' });
  return { db, repos, project, task };
}

function makeRun(
  ctx: ReturnType<typeof setup>,
  input: { state?: string; createdAt?: string; projectId?: string; taskId?: string } = {},
) {
  const run = ctx.repos.runs.create({
    projectId: input.projectId ?? ctx.project.id,
    taskId: input.taskId ?? ctx.task.id,
    idempotencyKey: `k-${Math.random()}`,
    trigger: 'schedule',
  });
  ctx.db
    .connection()
    .query('UPDATE runs SET state = ?, created_at = ? WHERE id = ?')
    .run(
      input.state ?? RunState.Succeeded,
      input.createdAt ?? '2026-07-10T00:00:00.000Z',
      run.id,
    );
  return run;
}

describe('getDashboardImpact', () => {
  test('aggregates merges, PR states, and category counts from canonical records', () => {
    const ctx = setup();
    const { repos } = ctx;

    const mergedRun = makeRun(ctx);
    repos.runIntegrations.upsertForRun({
      runId: mergedRun.id,
      mode: 'pull-request',
      prNumber: 1,
      prUrl: 'http://forge.local/a/pulls/1',
      status: 'merged',
      mergedAt: '2026-07-10T01:00:00.000Z',
    });
    repos.runImpactItems.replaceForRun(mergedRun.id, null, [
      {
        category: 'dependency-update',
        subject: 'croner',
        summary: 'bump',
        source: 'agent',
        verification: 'verified',
      },
      {
        category: 'bug-prevention',
        subject: 'lockfile drift',
        summary: 'subjective',
        source: 'agent',
        verification: 'claimed',
      },
    ]);

    const openRun = makeRun(ctx);
    repos.runIntegrations.upsertForRun({
      runId: openRun.id,
      mode: 'pull-request',
      prNumber: 2,
      prUrl: 'http://forge.local/a/pulls/2',
      status: 'open',
      openedAt: '2026-07-10T02:00:00.000Z',
      nextCheckAt: '2026-07-27T20:00:00.000Z',
    });

    const closedRun = makeRun(ctx);
    repos.runIntegrations.upsertForRun({
      runId: closedRun.id,
      mode: 'pull-request',
      prNumber: 3,
      prUrl: 'http://forge.local/a/pulls/3',
      status: 'closed',
    });

    // A commit-only run: counted in commits, excluded from merge rate.
    const commitRun = makeRun(ctx);
    repos.runIntegrations.upsertForRun({
      runId: commitRun.id,
      mode: 'commit-only',
      status: 'committed',
      commitSha: 'abc',
    });

    // A failed run does not add successful-run counts.
    makeRun(ctx, { state: RunState.Failed });

    const impact = getDashboardImpact(ctx.db);
    expect(impact.totals.succeededRuns).toBe(4);
    expect(impact.totals.prsOpened).toBe(3);
    expect(impact.totals.prsOpen).toBe(1);
    expect(impact.totals.mergedRuns).toBe(1);
    expect(impact.totals.closedUnmerged).toBe(1);
    expect(impact.totals.commits).toBe(1);
    expect(impact.totals.mergeRate).toBeCloseTo(1 / 3);

    expect(impact.categories).toEqual([
      { category: 'bug-prevention', verification: 'claimed', count: 1 },
      { category: 'dependency-update', verification: 'verified', count: 1 },
    ]);

    expect(impact.recentItems).toHaveLength(2);
    expect(impact.recentItems[0]?.projectName).toBe('alpha');
    expect(impact.recentItems[0]?.taskName).toBe('deps');
    ctx.db.close();
  });

  test('applies project and time-range filters', () => {
    const ctx = setup();
    const { repos } = ctx;
    const other = repos.projects.create({ name: 'beta', repoPath: '/tmp/beta' });
    const otherTask = repos.tasks.create({ projectId: other.id, name: 'docs', prompt: 'y' });

    const inRange = makeRun(ctx, { createdAt: '2026-07-10T00:00:00.000Z' });
    repos.runIntegrations.upsertForRun({
      runId: inRange.id,
      mode: 'auto-merge',
      status: 'merged',
      commitSha: 'sha1',
    });
    repos.runImpactItems.replaceForRun(inRange.id, null, [
      {
        category: 'documentation',
        subject: 'docs/a.md',
        summary: 'doc',
        source: 'platform',
        verification: 'verified',
      },
    ]);

    const outOfRange = makeRun(ctx, { createdAt: '2026-01-01T00:00:00.000Z' });
    repos.runIntegrations.upsertForRun({
      runId: outOfRange.id,
      mode: 'auto-merge',
      status: 'merged',
      commitSha: 'sha2',
    });

    const otherProjectRun = makeRun(ctx, {
      projectId: other.id,
      taskId: otherTask.id,
      createdAt: '2026-07-11T00:00:00.000Z',
    });
    repos.runIntegrations.upsertForRun({
      runId: otherProjectRun.id,
      mode: 'auto-merge',
      status: 'merged',
      commitSha: 'sha3',
    });

    const filtered = getDashboardImpact(ctx.db, {
      projectId: ctx.project.id,
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-31T23:59:59.999Z',
    });
    expect(filtered.totals.mergedRuns).toBe(1);
    expect(filtered.totals.succeededRuns).toBe(1);
    expect(filtered.recentItems).toHaveLength(1);
    expect(filtered.recentItems[0]?.subject).toBe('docs/a.md');

    const lifetime = getDashboardImpact(ctx.db);
    expect(lifetime.totals.mergedRuns).toBe(3);
    ctx.db.close();
  });

  test('returns null merge rate and empty lists on empty databases', () => {
    const ctx = setup();
    const impact = getDashboardImpact(ctx.db);
    expect(impact.totals.mergeRate).toBeNull();
    expect(impact.totals.succeededRuns).toBe(0);
    expect(impact.categories).toEqual([]);
    expect(impact.recentItems).toEqual([]);
    ctx.db.close();
  });
});

