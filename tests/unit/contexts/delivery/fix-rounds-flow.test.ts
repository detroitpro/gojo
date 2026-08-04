import {
  createApprovalRepository,
  createControlIntentRepository,
} from "@/contexts/delivery/contract";
import { afterEach, describe, expect, test } from 'bun:test';

import { ApprovalService } from '@/contexts/delivery/application/approval-service';
import {
  fixRoundEscalateReason,
  formatChecksSummary,
  resolveApprovalForIntegration,
  resolveFixRoundSubject,
} from '@/contexts/delivery/domain/fix-rounds';
import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from '@/infrastructure/persistence';
import { createWorkRepositories } from '@/contexts/work/contract';

/**
 * Exercises the schedule fix-round contract the way context.ts wires it:
 * subject fallback, approval lookup after assignRun, cap escalate, and
 * issue-driven subject preference — without booting the full app context.
 */
describe('fix-round flow (schedule + issue-driven)', () => {
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  function setup() {
    db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const work = createWorkRepositories(db);
    const project = repos.projects.create({
      name: 'rhystic',
      repoPath: '/tmp/rhystic',
    });
    const agent = repos.agents.create({
      projectId: project.id,
      name: 'maintain-seat-domain',
      prompt: 'seat',
    });
    const connection = work.connections.create({
      name: 'forge',
      adapter: 'forgejo',
      baseUrl: 'http://forge.local',
      capabilities: {
        read: true,
        list: true,
        webhooks: false,
        write: true,
        workKinds: ['pull-request', 'issue'],
      },
    });
    const source = work.sources.create({
      projectId: project.id,
      connectionId: connection.id,
      kind: 'repository',
      externalKey: 'detroitpro/rhystic-gaming',
      displayName: 'rhystic-gaming',
    });
    const approvals = new ApprovalService({
      approvals: createApprovalRepository(db!),
      intents: createControlIntentRepository(db!),
      merge: async () => ({ status: 'blocked', detail: 'test' }),
    });
    return { repos, work, project, agent, source, approvals };
  }

  test('schedule PR with null subjectJson enqueues a fix against the PR work item', () => {
    const { repos, work, project, agent, source, approvals } = setup();
    const run = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      trigger: 'schedule',
      idempotencyKey: 'sched-1',
    });
    const pr = work.items.create({
      projectId: project.id,
      sourceId: source.id,
      kind: 'pull-request',
      nativeKey: '96',
      title: 'Strengthen seat-domain tests',
      delivery: 'open',
      webUrl: 'http://forge/pulls/96',
    });
    const approval = approvals.create({
      projectId: project.id,
      subjectType: 'pull-request',
      subjectId: pr.id,
      runId: run.id,
      workItemId: pr.id,
      autonomy: 'reviewer',
      checksState: 'failure',
      evidence: {
        resumeBranch: 'gojo/maintain-seat-domain/rhystic/2026-08-03/run-1',
        fixRounds: 2,
        implementingAgentId: agent.id,
        implementingAgentName: agent.name,
      },
    });

    // Schedule runs have no subjectJson — fall back to the PR work item.
    const subjectWorkItemId = resolveFixRoundSubject({
      originalSubjectWorkItemId: null,
      approvalWorkItemId: approval.workItemId,
    });
    expect(subjectWorkItemId).toBe(pr.id);
    expect(
      fixRoundEscalateReason({
        hasImplementingRun: true,
        hasImplementingAgent: true,
        attempts: approval.attempts,
        maxRounds: 2,
        resumeBranch: 'gojo/maintain-seat-domain/rhystic/2026-08-03/run-1',
        subjectWorkItemId,
      }),
    ).toBeNull();

    const next = approvals.beginFixRound(approval.id, {
      checksSummary: formatChecksSummary([
        {
          id: '6',
          name: 'ci/woodpecker/pr/ci',
          status: 'failure',
          details: 'eslint failed',
          webUrl: 'http://ci/118',
        },
      ]),
    });
    const fixRun = repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      trigger: 'work',
      idempotencyKey: `fix:${pr.id}:${agent.id}:${next.attempts}`,
    });
    approvals.assignRun(approval.id, fixRun.id);

    // Original integration row can no longer findByRun — PR subject must work.
    const resolved = resolveApprovalForIntegration({
      integrationRunId: run.id,
      integrationPrUrl: pr.webUrl,
      findByRun: (runId) => approvals.findByRun(runId),
      findBySubject: (type, id) => approvals.findBySubject(type, id),
      findWorkItemByWebUrl: (url) => work.items.findByWebUrl(url),
    });
    expect(resolved?.id).toBe(approval.id);
    expect(resolved?.runId).toBe(fixRun.id);
    expect(resolved?.attempts).toBe(1);
  });

  test('issue-driven fix rounds keep the original issue subject', () => {
    const { work, project, source } = setup();
    const issue = work.items.create({
      projectId: project.id,
      sourceId: source.id,
      kind: 'issue',
      nativeKey: '42',
      title: 'Fix seat bug',
      delivery: 'open',
    });
    const pr = work.items.create({
      projectId: project.id,
      sourceId: source.id,
      kind: 'pull-request',
      nativeKey: '43',
      title: 'Implement seat fix',
      delivery: 'open',
      webUrl: 'http://forge/pulls/43',
    });

    expect(
      resolveFixRoundSubject({
        originalSubjectWorkItemId: issue.id,
        approvalWorkItemId: pr.id,
      }),
    ).toBe(issue.id);
  });

  test('cap reached escalates with a distinct reason', () => {
    expect(
      fixRoundEscalateReason({
        hasImplementingRun: true,
        hasImplementingAgent: true,
        attempts: 2,
        maxRounds: 2,
        resumeBranch: 'gojo/x',
        subjectWorkItemId: 'pr-1',
      }),
    ).toBe('Automated fix-round cap reached');
  });
});
