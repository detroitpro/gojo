import { afterEach, describe, expect, test } from 'bun:test';

import { ApprovalService } from '@/control/service';
import { Database, createRepositories } from '@/storage';

describe('control approval service', () => {
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  function setup(mergeResult: { status: 'merged' | 'scheduled' | 'blocked'; detail?: string }) {
    db = Database.open(':memory:');
    db.migrate();
    const project = createRepositories(db).projects.create({
      name: 'control-demo',
      repoPath: '/tmp/control',
    });
    const merges: string[] = [];
    const service = new ApprovalService({
      db,
      merge: async (approval) => {
        merges.push(approval.id);
        return mergeResult;
      },
    });
    return { project, service, merges };
  }

  test('auto autonomy merges after green checks without a reviewer verdict', async () => {
    const { project, service, merges } = setup({ status: 'merged' });
    const approval = service.create({
      projectId: project.id,
      subjectType: 'pull-request',
      subjectId: 'pr-1',
      autonomy: 'auto',
      checksState: 'pending',
    });

    await service.recordChecks(approval.id, 'success', { checkSuite: 'ci-1' });
    expect(merges).toEqual([approval.id]);
    expect(service.findById(approval.id)?.state).toBe('applied');
  });

  test('reviewer autonomy still requires a passing review before merge', async () => {
    const { project, service, merges } = setup({ status: 'merged' });
    const approval = service.create({
      projectId: project.id,
      subjectType: 'pull-request',
      subjectId: 'pr-1b',
      autonomy: 'reviewer',
      checksState: 'pending',
    });

    await service.recordChecks(approval.id, 'success', { checkSuite: 'ci-1' });
    expect(merges).toHaveLength(0);
    expect(service.findById(approval.id)?.state).toBe('pending-review');

    await service.recordReview(approval.id, 'pass', { reviewerRunId: 'run-review' });
    expect(merges).toEqual([approval.id]);
    expect(service.findById(approval.id)?.state).toBe('applied');
  });

  test('manual autonomy waits for an explicit intent after review and checks', async () => {
    const { project, service, merges } = setup({ status: 'merged' });
    const approval = service.create({
      projectId: project.id,
      subjectType: 'pull-request',
      subjectId: 'pr-2',
      autonomy: 'manual',
      checksState: 'pending',
    });

    await service.recordChecks(approval.id, 'success');
    await service.recordReview(approval.id, 'pass');
    expect(service.findById(approval.id)?.state).toBe('awaiting-human');
    expect(merges).toHaveLength(0);

    const intent = await service.submitIntent({
      projectId: project.id,
      kind: 'approve',
      targetType: 'approval',
      targetId: approval.id,
      actor: 'detroitpro',
      surface: 'ui',
      surfaceRef: 'request-1',
    });
    expect(intent.state).toBe('applied');
    expect(merges).toEqual([approval.id]);
    expect(service.findById(approval.id)?.state).toBe('applied');
  });

  test('deduplicates repeated surface intents without merging twice', async () => {
    const { project, service, merges } = setup({ status: 'merged' });
    const approval = service.create({
      projectId: project.id,
      subjectType: 'pull-request',
      subjectId: 'pr-3',
      autonomy: 'manual',
      checksState: 'success',
      reviewVerdict: 'pass',
      state: 'awaiting-human',
    });
    const intent = {
      projectId: project.id,
      kind: 'approve' as const,
      targetType: 'approval',
      targetId: approval.id,
      actor: 'detroitpro',
      surface: 'forge-comment' as const,
      surfaceRef: 'comment-99',
    };

    const first = await service.submitIntent(intent);
    const second = await service.submitIntent(intent);
    expect(second.id).toBe(first.id);
    expect(merges).toHaveLength(1);
  });

  test('never merges failed checks or changes-requested reviews', async () => {
    const { project, service, merges } = setup({ status: 'merged' });
    const approval = service.create({
      projectId: project.id,
      subjectType: 'pull-request',
      subjectId: 'pr-4',
      autonomy: 'auto',
      checksState: 'pending',
    });

    await service.recordChecks(approval.id, 'failure');
    await service.recordReview(approval.id, 'changes-requested');
    expect(merges).toHaveLength(0);
    expect(service.findById(approval.id)).toMatchObject({
      state: 'failed',
      checksState: 'failure',
      reviewVerdict: 'changes-requested',
    });
  });

  test('detaches stale reconciliation while a fix round is queued', () => {
    const { project, service } = setup({ status: 'merged' });
    const repos = createRepositories(db!);
    const agent = repos.agents.create({
      projectId: project.id,
      name: 'implement',
      prompt: 'fix',
    });
    const firstRun = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      trigger: 'work',
      idempotencyKey: 'first-run',
    });
    const fixRun = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      trigger: 'work',
      idempotencyKey: 'fix-run',
    });
    const approval = service.create({
      projectId: project.id,
      subjectType: 'pull-request',
      subjectId: 'pr-fix',
      runId: firstRun.id,
      autonomy: 'reviewer',
      checksState: 'failure',
    });

    const fixing = service.beginFixRound(approval.id, { check: 'red' });
    expect(fixing).toMatchObject({
      runId: null,
      attempts: 1,
      checksState: 'pending',
      state: 'pending-review',
    });
    expect(service.findByRun(firstRun.id)).toBeNull();

    service.assignRun(approval.id, fixRun.id);
    expect(service.findByRun(fixRun.id)?.id).toBe(approval.id);
  });
});
