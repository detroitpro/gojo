import { describe, expect, test } from 'bun:test';

import {
  ApprovalSchema,
  ControlIntentSchema,
  CreateApprovalSchema,
  SubmitControlIntentSchema,
} from '@shared/approvals';

describe('shared approvals', () => {
  test('accepts a durable pull-request approval', () => {
    const approval = ApprovalSchema.parse({
      id: 'approval-1',
      projectId: 'project-1',
      subjectType: 'pull-request',
      subjectId: 'work-1',
      runId: 'run-1',
      workItemId: 'work-1',
      reason: 'Agent-authored pull request',
      autonomy: 'reviewer',
      state: 'pending-review',
      reviewVerdict: null,
      checksState: 'pending',
      evidence: {},
      decidedBy: null,
      decidedVia: null,
      note: null,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });

    expect(approval.state).toBe('pending-review');
    expect(approval.checksState).toBe('pending');
  });

  test('accepts a hold review verdict', () => {
    const approval = ApprovalSchema.parse({
      id: 'approval-hold',
      projectId: 'project-1',
      subjectType: 'pull-request',
      subjectId: 'work-1',
      runId: 'run-1',
      workItemId: 'work-1',
      reason: 'High-impact reviewer hold',
      autonomy: 'reviewer',
      state: 'awaiting-human',
      reviewVerdict: 'hold',
      checksState: 'success',
      evidence: {},
      decidedBy: null,
      decidedVia: null,
      note: null,
      attempts: 0,
      nextAttemptAt: null,
      lastError: 'Reviewer held for human review',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    });
    expect(approval.reviewVerdict).toBe('hold');
    expect(approval.state).toBe('awaiting-human');
  });

  test('rejects negative repair attempts and invalid approval states', () => {
    expect(
      CreateApprovalSchema.safeParse({
        projectId: 'project-1',
        subjectType: 'pull-request',
        subjectId: 'work-1',
        autonomy: 'reviewer',
        state: 'waiting-forever',
        attempts: -1,
      }).success,
    ).toBe(false);
  });

  test('accepts normalized control intents and rejects unknown surfaces', () => {
    expect(
      SubmitControlIntentSchema.parse({
        projectId: 'project-1',
        kind: 'approve',
        targetType: 'approval',
        targetId: 'approval-1',
        actor: 'detroitpro',
        surface: 'forge-comment',
        surfaceRef: 'comment-42',
      }).kind,
    ).toBe('approve');

    expect(
      ControlIntentSchema.safeParse({
        id: 'intent-1',
        projectId: 'project-1',
        kind: 'approve',
        targetType: 'approval',
        targetId: 'approval-1',
        actor: 'detroitpro',
        surface: 'carrier-pigeon',
        surfaceRef: null,
        note: null,
        state: 'applied',
        error: null,
        createdAt: '2026-07-30T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
