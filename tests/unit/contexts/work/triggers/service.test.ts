import { afterEach, describe, expect, test } from 'bun:test';

import { WorkTriggerService } from '@/contexts/work/application/triggers/service';
import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from '@/infrastructure/persistence';
import { createWorkRepositories } from '@/contexts/work/contract';

describe('work trigger service', () => {
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  test('claims an authorized issue once and applies platform-owned source actions', async () => {
    db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const work = createWorkRepositories(db);
    const project = repos.projects.create({ name: 'trigger-demo', repoPath: '/tmp/trigger' });
    const agent = repos.agents.create({
      projectId: project.id,
      name: 'implement-issue',
      prompt: 'implement',
      triggerJson: JSON.stringify({
        on: 'issue-label',
        requireLabels: ['gojo:ready'],
        anyLabels: ['area:api'],
        excludeLabels: ['gojo:blocked', 'gojo:in-progress'],
        trustedActors: ['detroitpro'],
        maxOpenClaims: 1,
      }),
    });
    const issue = work.items.create({
      projectId: project.id,
      kind: 'issue',
      nativeKey: '42',
      title: 'Issue 42',
      delivery: 'open',
      labels: ['gojo:ready', 'area:api'],
      syncState: 'current',
    });
    const enqueued: Array<{ idempotencyKey?: string; subjectWorkItemId?: string }> = [];
    const comments: string[] = [];
    const labels: string[] = [];
    const service = new WorkTriggerService({
      db,
      enqueue: async (input) => {
        enqueued.push(input);
        return repos.runs.create({
          projectId: project.id,
          agentId: agent.id,
          idempotencyKey: input.idempotencyKey!,
          trigger: 'work',
          state: 'Queued',
        });
      },
      runUrl: (runId) => `https://gojo.example/runs/${runId}`,
    });
    const observed = {
      workItemId: issue.id,
      previousLabels: ['area:api'],
      labelActors: [{ label: 'gojo:ready', action: 'add' as const, actor: 'detroitpro' }],
      comment: async (body: string) => {
        comments.push(body);
      },
      addLabels: async (add: string[]) => {
        labels.push(...add);
      },
    };

    expect(await service.observe(observed)).toHaveLength(1);
    expect(await service.observe(observed)).toHaveLength(0);
    expect(enqueued).toEqual([
      expect.objectContaining({
        agentId: agent.id,
        trigger: 'work',
        idempotencyKey: `implement:${issue.id}:${agent.id}`,
        subjectWorkItemId: issue.id,
      }),
    ]);
    expect(comments[0]).toContain('https://gojo.example/runs/');
    expect(labels).toEqual(['gojo:in-progress']);
  });

  test('does not enqueue when the authorizing label actor is untrusted', async () => {
    db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const work = createWorkRepositories(db);
    const project = repos.projects.create({ name: 'trigger-demo', repoPath: '/tmp/trigger' });
    repos.agents.create({
      projectId: project.id,
      name: 'implement-issue',
      prompt: 'implement',
      triggerJson: JSON.stringify({
        on: 'issue-label',
        requireLabels: ['gojo:ready'],
        trustedActors: ['detroitpro'],
        maxOpenClaims: 1,
      }),
    });
    const issue = work.items.create({
      projectId: project.id,
      kind: 'issue',
      title: 'Untrusted issue',
      delivery: 'open',
      labels: ['gojo:ready'],
    });
    let enqueues = 0;
    const service = new WorkTriggerService({
      db,
      enqueue: async () => {
        enqueues += 1;
        throw new Error('must not enqueue');
      },
    });

    expect(
      await service.observe({
        workItemId: issue.id,
        previousLabels: [],
        labelActors: [{ label: 'gojo:ready', action: 'add', actor: 'outsider' }],
      }),
    ).toHaveLength(0);
    expect(enqueues).toBe(0);
  });

  test('does not enqueue when the project is disabled', async () => {
    db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const work = createWorkRepositories(db);
    const project = repos.projects.create({ name: 'trigger-demo', repoPath: '/tmp/trigger' });
    repos.projects.update(project.id, { enabled: false });
    repos.agents.create({
      projectId: project.id,
      name: 'implement-issue',
      prompt: 'implement',
      triggerJson: JSON.stringify({
        on: 'issue-label',
        requireLabels: ['gojo:ready'],
        trustedActors: ['detroitpro'],
        maxOpenClaims: 1,
      }),
    });
    const issue = work.items.create({
      projectId: project.id,
      kind: 'issue',
      title: 'Issue',
      delivery: 'open',
      labels: ['gojo:ready'],
    });
    const service = new WorkTriggerService({
      db,
      enqueue: async () => {
        throw new Error('must not enqueue');
      },
    });

    expect(
      await service.observe({
        workItemId: issue.id,
        previousLabels: [],
        labelActors: [{ label: 'gojo:ready', action: 'add', actor: 'detroitpro' }],
      }),
    ).toHaveLength(0);
  });

  test('re-applies gojo:in-progress when a claim run already exists', async () => {
    db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const work = createWorkRepositories(db);
    const project = repos.projects.create({ name: 'trigger-demo', repoPath: '/tmp/trigger' });
    const agent = repos.agents.create({
      projectId: project.id,
      name: 'implement-issue',
      prompt: 'implement',
      triggerJson: JSON.stringify({
        on: 'issue-label',
        requireLabels: ['gojo:ready'],
        trustedActors: ['detroitpro'],
        maxOpenClaims: 1,
      }),
    });
    const issue = work.items.create({
      projectId: project.id,
      kind: 'issue',
      title: 'Claimed issue',
      delivery: 'open',
      labels: ['gojo:ready'],
    });
    repos.runs.create({
      projectId: project.id,
      agentId: agent.id,
      idempotencyKey: `implement:${issue.id}:${agent.id}`,
      trigger: 'work',
      state: 'Running',
    });

    const labels: string[] = [];
    const service = new WorkTriggerService({
      db,
      enqueue: async () => {
        throw new Error('must not enqueue');
      },
    });

    expect(
      await service.observe({
        workItemId: issue.id,
        previousLabels: [],
        labelActors: [],
        addLabels: async (add) => {
          labels.push(...add);
        },
      }),
    ).toHaveLength(0);
    expect(labels).toEqual(['gojo:in-progress']);
  });
});
