import { describe, expect, test } from 'bun:test';

import {
  agentConfiguredAutonomy,
  fixRoundEscalateReason,
  formatChecksSummary,
  isRetryableFixRoundStall,
  resolveApprovalForIntegration,
  resolveFixRoundSubject,
} from '@/contexts/delivery/domain/fix-rounds';
import type { Approval } from '@shared/approvals';

function approval(overrides: Partial<Approval> & { id: string }): Approval {
  return {
    projectId: 'proj',
    subjectType: 'pull-request',
    subjectId: 'subj',
    runId: null,
    workItemId: null,
    reason: '',
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
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveFixRoundSubject', () => {
  test('prefers the original issue subject when present', () => {
    expect(
      resolveFixRoundSubject({
        originalSubjectWorkItemId: 'issue-1',
        approvalWorkItemId: 'pr-1',
      }),
    ).toBe('issue-1');
  });

  test('falls back to the approval PR work item for schedule runs', () => {
    expect(
      resolveFixRoundSubject({
        originalSubjectWorkItemId: null,
        approvalWorkItemId: 'pr-1',
      }),
    ).toBe('pr-1');
  });

  test('returns null when neither subject exists', () => {
    expect(
      resolveFixRoundSubject({
        originalSubjectWorkItemId: null,
        approvalWorkItemId: null,
      }),
    ).toBeNull();
  });
});

describe('fixRoundEscalateReason', () => {
  const ok = {
    hasImplementingRun: true,
    hasImplementingAgent: true,
    attempts: 0,
    maxRounds: 2,
    resumeBranch: 'gojo/maintain/run-1',
    subjectWorkItemId: 'pr-1',
  };

  test('returns null when the fix round can start', () => {
    expect(fixRoundEscalateReason(ok)).toBeNull();
  });

  test('splits cap, branch, and subject escalate reasons', () => {
    expect(
      fixRoundEscalateReason({ ...ok, attempts: 2 }),
    ).toBe('Automated fix-round cap reached');
    expect(
      fixRoundEscalateReason({ ...ok, resumeBranch: null }),
    ).toBe('Pull request branch is unavailable');
    expect(
      fixRoundEscalateReason({ ...ok, subjectWorkItemId: null }),
    ).toBe('Fix-round subject is unavailable');
    expect(
      fixRoundEscalateReason({ ...ok, hasImplementingAgent: false }),
    ).toBe('Implementing run or agent no longer exists');
  });
});

describe('resolveApprovalForIntegration', () => {
  test('returns the approval linked to the integration run when present', () => {
    const linked = approval({ id: 'a1', runId: 'run-orig' });
    const found = resolveApprovalForIntegration({
      integrationRunId: 'run-orig',
      integrationPrUrl: 'http://forge/pulls/96',
      findByRun: (runId) => (runId === 'run-orig' ? linked : null),
      findBySubject: () => null,
      findWorkItemByWebUrl: () => null,
    });
    expect(found?.id).toBe('a1');
  });

  test('falls back to PR work-item subject after runId was reassigned to a fix run', () => {
    const afterFix = approval({
      id: 'a2',
      runId: 'run-fix',
      workItemId: 'wi-pr-96',
      subjectId: 'wi-pr-96',
    });
    const found = resolveApprovalForIntegration({
      integrationRunId: 'run-orig',
      integrationPrUrl: 'http://forge/pulls/96',
      findByRun: () => null,
      findBySubject: (type, id) =>
        type === 'pull-request' && id === 'wi-pr-96' ? afterFix : null,
      findWorkItemByWebUrl: (url) =>
        url === 'http://forge/pulls/96' ? { id: 'wi-pr-96' } : null,
    });
    expect(found?.id).toBe('a2');
    expect(found?.runId).toBe('run-fix');
  });

  test('uses attempt prUrl when integration.prUrl is empty', () => {
    const afterFix = approval({ id: 'a3', subjectId: 'wi-pr' });
    const found = resolveApprovalForIntegration({
      integrationRunId: 'run-orig',
      integrationPrUrl: null,
      findByRun: () => null,
      findBySubject: (_t, id) => (id === 'wi-pr' ? afterFix : null),
      findWorkItemByWebUrl: (url) =>
        url === 'http://forge/pulls/1' ? { id: 'wi-pr' } : null,
      findAttemptPrUrl: (runId) =>
        runId === 'run-orig' ? 'http://forge/pulls/1' : null,
    });
    expect(found?.id).toBe('a3');
  });

  test('returns null when neither run nor PR subject can be resolved', () => {
    expect(
      resolveApprovalForIntegration({
        integrationRunId: 'run-x',
        integrationPrUrl: null,
        findByRun: () => null,
        findBySubject: () => null,
        findWorkItemByWebUrl: () => null,
      }),
    ).toBeNull();
  });
});

describe('isRetryableFixRoundStall', () => {
  test('matches current and legacy subject/branch escalate messages', () => {
    expect(
      isRetryableFixRoundStall({
        state: 'awaiting-human',
        reviewVerdict: 'changes-requested',
        lastError: 'Fix-round subject is unavailable',
        evidence: { resumeBranch: 'gojo/x', fixRounds: 2 },
      }),
    ).toBe(true);
    expect(
      isRetryableFixRoundStall({
        state: 'awaiting-human',
        reviewVerdict: 'changes-requested',
        lastError: 'Pull request branch or original issue context is unavailable',
        evidence: { resumeBranch: 'gojo/x', fixRounds: 2 },
      }),
    ).toBe(true);
    expect(
      isRetryableFixRoundStall({
        state: 'awaiting-human',
        reviewVerdict: 'changes-requested',
        lastError: 'Pull request branch is unavailable',
        evidence: { resumeBranch: 'gojo/x', fixRounds: 2 },
      }),
    ).toBe(true);
  });

  test('skips when already retried, missing resumeBranch, or wrong state', () => {
    expect(
      isRetryableFixRoundStall({
        state: 'awaiting-human',
        reviewVerdict: 'changes-requested',
        lastError: 'Fix-round subject is unavailable',
        evidence: {
          resumeBranch: 'gojo/x',
          fixRounds: 2,
          fixRoundStallRetried: true,
        },
      }),
    ).toBe(false);
    expect(
      isRetryableFixRoundStall({
        state: 'awaiting-human',
        reviewVerdict: 'changes-requested',
        lastError: 'Fix-round subject is unavailable',
        evidence: { fixRounds: 2 },
      }),
    ).toBe(false);
    expect(
      isRetryableFixRoundStall({
        state: 'awaiting-human',
        reviewVerdict: 'pass',
        lastError: 'Fix-round subject is unavailable',
        evidence: { resumeBranch: 'gojo/x', fixRounds: 2 },
      }),
    ).toBe(false);
  });
});

describe('agentConfiguredAutonomy', () => {
  test('reads approval from integration JSON', () => {
    expect(agentConfiguredAutonomy('{"approval":"reviewer"}')).toBe('reviewer');
    expect(agentConfiguredAutonomy('{"mode":"pull-request"}')).toBeNull();
    expect(agentConfiguredAutonomy('not-json')).toBeNull();
  });
});

describe('formatChecksSummary', () => {
  test('includes name, details, and URL for each check', () => {
    const summary = formatChecksSummary([
      {
        id: '6',
        name: 'ci/woodpecker/pr/ci',
        status: 'failure',
        details: 'eslint: Unexpected any',
        webUrl: 'http://ci/pipeline/118',
      },
    ]);
    expect(summary).toContain('ci/woodpecker/pr/ci');
    expect(summary).toContain('eslint: Unexpected any');
    expect(summary).toContain('http://ci/pipeline/118');
  });

  test('falls back to status when details are missing', () => {
    expect(
      formatChecksSummary([
        { id: '1', name: 'ci', status: 'failure', details: null },
      ]),
    ).toBe('ci: failure');
  });

  test('returns empty JSON array for no checks', () => {
    expect(formatChecksSummary([])).toBe('[]');
  });
});
