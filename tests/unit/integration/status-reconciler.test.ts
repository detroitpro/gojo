import { describe, expect, test } from 'bun:test';

import {
  IntegrationStatusReconciler,
  computeNextCheckAt,
  extractPrNumber,
  fetchForgejoPrStatus,
  fetchGithubPrStatus,
  initialNextCheckAt,
} from '@/integration/status-reconciler';
import { Database, createRepositories } from '@/storage';
import type { RunIntegration } from '@/storage/types';

function openDb() {
  const db = Database.open(':memory:');
  db.migrate();
  return { db, repos: createRepositories(db) };
}

function seedOpenIntegration(
  repos: ReturnType<typeof createRepositories>,
  overrides: { nextCheckAt?: string } = {},
): RunIntegration {
  const project = repos.projects.create({ name: 'p', repoPath: '/tmp/p' });
  const task = repos.tasks.create({ projectId: project.id, name: 't', prompt: 'x' });
  const run = repos.runs.create({
    projectId: project.id,
    taskId: task.id,
    idempotencyKey: `k-${Math.random()}`,
    trigger: 'manual',
  });
  return repos.runIntegrations.upsertForRun({
    runId: run.id,
    mode: 'pull-request',
    provider: 'forgejo',
    apiUrl: 'http://forge.local',
    repo: 'me/app',
    prNumber: 12,
    prUrl: 'http://forge.local/me/app/pulls/12',
    status: 'open',
    openedAt: '2026-07-01T00:00:00.000Z',
    nextCheckAt: overrides.nextCheckAt ?? '2026-07-01T00:05:00.000Z',
  });
}

describe('extractPrNumber', () => {
  test('parses Forgejo and GitHub URLs', () => {
    expect(extractPrNumber('http://forge.local/me/app/pulls/54')).toBe(54);
    expect(extractPrNumber('https://github.com/me/app/pull/7')).toBe(7);
    expect(extractPrNumber('https://github.com/me/app')).toBeNull();
    expect(extractPrNumber('local://pr/gojo/run')).toBeNull();
  });
});

describe('backoff', () => {
  test('doubles from five minutes and caps at six hours', () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    expect(initialNextCheckAt(now)).toBe('2026-07-01T00:05:00.000Z');
    expect(computeNextCheckAt(1, now)).toBe('2026-07-01T00:10:00.000Z');
    expect(computeNextCheckAt(3, now)).toBe('2026-07-01T00:40:00.000Z');
    expect(computeNextCheckAt(30, now)).toBe('2026-07-01T06:00:00.000Z');
  });
});

describe('fetchForgejoPrStatus', () => {
  test('maps merged, closed, and open responses', async () => {
    const respond = (body: unknown) =>
      (async () =>
        new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

    const merged = await fetchForgejoPrStatus({
      apiUrl: 'http://forge.local',
      repo: 'me/app',
      prNumber: 1,
      token: 'tok',
      fetchImpl: respond({ state: 'closed', merged: true, merged_at: '2026-07-01T01:00:00Z' }),
    });
    expect(merged).toEqual({ state: 'merged', mergedAt: '2026-07-01T01:00:00Z' });

    const closed = await fetchForgejoPrStatus({
      apiUrl: 'http://forge.local',
      repo: 'me/app',
      prNumber: 1,
      token: 'tok',
      fetchImpl: respond({ state: 'closed', merged: false, closed_at: '2026-07-01T02:00:00Z' }),
    });
    expect(closed).toEqual({ state: 'closed', closedAt: '2026-07-01T02:00:00Z' });

    const open = await fetchForgejoPrStatus({
      apiUrl: 'http://forge.local',
      repo: 'me/app',
      prNumber: 1,
      token: 'tok',
      fetchImpl: respond({ state: 'open', merged: false }),
    });
    expect(open).toEqual({ state: 'open' });
  });

  test('throws on HTTP errors', async () => {
    const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchForgejoPrStatus({
        apiUrl: 'http://forge.local',
        repo: 'me/app',
        prNumber: 1,
        token: 'tok',
        fetchImpl: failing,
      }),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('fetchGithubPrStatus', () => {
  test('maps gh CLI output to outcome states', async () => {
    const result = await fetchGithubPrStatus({
      prUrl: 'https://github.com/me/app/pull/3',
      runProcessImpl: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-07-01T03:00:00Z' }),
        stderr: '',
        timedOut: false,
        signal: null,
        canceled: false,
        durationMs: 1,
      }),
    });
    expect(result).toEqual({ state: 'merged', mergedAt: '2026-07-01T03:00:00Z' });
  });

  test('throws when gh exits nonzero', async () => {
    await expect(
      fetchGithubPrStatus({
        prUrl: 'https://github.com/me/app/pull/3',
        runProcessImpl: async () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'auth required',
          timedOut: false,
          signal: null,
          canceled: false,
          durationMs: 1,
        }),
      }),
    ).rejects.toThrow('auth required');
  });
});

describe('IntegrationStatusReconciler', () => {
  test('marks due open integrations merged and stops polling', async () => {
    const { db, repos } = openDb();
    const integration = seedOpenIntegration(repos);

    const reconciler = new IntegrationStatusReconciler({
      db,
      fetchStatus: async () => ({ state: 'merged', mergedAt: '2026-07-01T01:00:00.000Z' }),
    });
    const summary = await reconciler.reconcile(new Date('2026-07-01T00:10:00.000Z'));
    expect(summary).toEqual({ checked: 1, merged: 1, closed: 0, errors: 0 });

    const updated = repos.runIntegrations.findByRun(integration.runId);
    expect(updated?.status).toBe('merged');
    expect(updated?.mergedAt).toBe('2026-07-01T01:00:00.000Z');
    expect(updated?.nextCheckAt).toBeNull();
    db.close();
  });

  test('keeps polling still-open PRs with exponential backoff', async () => {
    const { db, repos } = openDb();
    const integration = seedOpenIntegration(repos);

    const reconciler = new IntegrationStatusReconciler({
      db,
      fetchStatus: async () => ({ state: 'open' }),
    });
    await reconciler.reconcile(new Date('2026-07-01T00:10:00.000Z'));

    const updated = repos.runIntegrations.findByRun(integration.runId);
    expect(updated?.status).toBe('open');
    expect(updated?.checkCount).toBe(1);
    // 5min * 2^1 = 10 minutes after "now"
    expect(updated?.nextCheckAt).toBe('2026-07-01T00:20:00.000Z');
    db.close();
  });

  test('records transient failures and backs off without changing status', async () => {
    const { db, repos } = openDb();
    const integration = seedOpenIntegration(repos);

    const reconciler = new IntegrationStatusReconciler({
      db,
      fetchStatus: async () => {
        throw new Error('network down');
      },
    });
    const summary = await reconciler.reconcile(new Date('2026-07-01T00:10:00.000Z'));
    expect(summary.errors).toBe(1);

    const updated = repos.runIntegrations.findByRun(integration.runId);
    expect(updated?.status).toBe('open');
    expect(updated?.lastError).toBe('network down');
    expect(updated?.nextCheckAt).not.toBeNull();
    db.close();
  });

  test('ignores integrations that are not due and respects the batch limit', async () => {
    const { db, repos } = openDb();
    seedOpenIntegration(repos, { nextCheckAt: '2026-07-02T00:00:00.000Z' });
    seedOpenIntegration(repos);
    seedOpenIntegration(repos);

    let calls = 0;
    const reconciler = new IntegrationStatusReconciler({
      db,
      batchLimit: 1,
      fetchStatus: async () => {
        calls += 1;
        return { state: 'open' };
      },
    });
    const summary = await reconciler.reconcile(new Date('2026-07-01T00:10:00.000Z'));
    expect(summary.checked).toBe(1);
    expect(calls).toBe(1);
    db.close();
  });
});
