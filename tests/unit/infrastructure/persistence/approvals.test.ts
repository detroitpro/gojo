import { createApprovalRepository, createControlIntentRepository } from "@/contexts/delivery/contract";
import { afterEach, describe, expect, test } from 'bun:test';

import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from '@/infrastructure/persistence';

describe('storage approvals', () => {
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  function setup() {
    db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: 'approval-demo', repoPath: '/tmp/demo' });
    return { project, approvals: createApprovalRepository(db), intents: createControlIntentRepository(db) };
  }

  test('creates, updates, resolves, and pages approvals in the database', () => {
    const { project, approvals } = setup();
    const created = approvals.create({
      projectId: project.id,
      subjectType: 'pull-request',
      subjectId: 'pr-work-1',
      reason: 'Review agent-authored pull request',
      autonomy: 'reviewer',
      checksState: 'pending',
    });

    expect(approvals.findBySubject('pull-request', 'pr-work-1')?.id).toBe(created.id);
    expect(
      approvals.update(created.id, {
        state: 'awaiting-human',
        checksState: 'success',
        reviewVerdict: 'pass',
        attempts: 1,
      }),
    ).toMatchObject({
      state: 'awaiting-human',
      checksState: 'success',
      reviewVerdict: 'pass',
      attempts: 1,
    });

    expect(approvals.list({ projectId: project.id, state: 'awaiting-human', limit: 10, offset: 0 }))
      .toMatchObject({ total: 1, limit: 10, offset: 0 });
  });

  test('records idempotent surface intents for audit', () => {
    const { project, intents } = setup();
    const input = {
      projectId: project.id,
      kind: 'approve' as const,
      targetType: 'approval',
      targetId: 'approval-1',
      actor: 'detroitpro',
      surface: 'forge-comment' as const,
      surfaceRef: 'comment-42',
    };

    const first = intents.create({ ...input, state: 'applied' });
    const duplicate = intents.create({ ...input, state: 'duplicate' });

    expect(duplicate.id).toBe(first.id);
    expect(intents.findBySurfaceRef('forge-comment', 'comment-42')?.state).toBe('applied');
    expect(intents.listByTarget('approval', 'approval-1')).toHaveLength(1);
  });
});
