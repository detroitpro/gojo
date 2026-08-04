import { createApprovalRepository } from "@/contexts/delivery/contract";
import { createWorkRepositories } from "@/contexts/work/contract";
import { afterEach, describe, expect, test } from 'bun:test';

import { MergeService } from '@/contexts/delivery/application/merge-service';
import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from '@/infrastructure/persistence';
import { SourceAdapterRegistry, type SourceAdapter } from '@/contexts/work/contract';

describe('control merge service', () => {
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  function setup(checkStatus: 'pending' | 'success' | 'failure' = 'success') {
    db = Database.open(':memory:');
    db.migrate();
    const repos = createRepositories(db);
    const work = createWorkRepositories(db);
    const project = repos.projects.create({ name: 'merge-demo', repoPath: '/tmp/merge' });
    const connection = work.connections.create({
      name: 'forge',
      adapter: 'fake-forge',
      baseUrl: 'https://forge.example',
      configJson: JSON.stringify({ tokenSecretName: 'forge-token' }),
      capabilities: {
        read: true,
        list: true,
        webhooks: false,
        write: true,
        workKinds: ['pull-request'],
      },
    });
    const source = work.sources.create({
      projectId: project.id,
      connectionId: connection.id,
      kind: 'repository',
      externalKey: 'acme/demo',
      displayName: 'acme/demo',
    });
    const pullRequest = work.items.create({
      projectId: project.id,
      sourceId: source.id,
      kind: 'pull-request',
      nativeKey: '42',
      title: 'Agent change',
      delivery: 'open',
      nativeState: 'open',
    });
    const merges: unknown[] = [];
    const adapter: SourceAdapter = {
      type: 'fake-forge',
      capabilities: connection.capabilities,
      async listActive() {
        return { items: [], cursor: null, backfillComplete: true };
      },
      async getChecks() {
        return { status: checkStatus, checks: [] };
      },
      async mergePullRequest(input) {
        merges.push(input);
        if (input.whenChecksSucceed) {
          return { status: 'scheduled', detail: null };
        }
        return { status: 'merged', detail: null, mergeSha: 'abc123' };
      },
    };
    const approval = createApprovalRepository(db).create({
      projectId: project.id,
      subjectType: 'pull-request',
      subjectId: pullRequest.id,
      workItemId: pullRequest.id,
      autonomy: 'auto',
      state: 'approved',
      checksState: 'success',
      reviewVerdict: 'pass',
    });
    const service = new MergeService({
      db,
      registry: new SourceAdapterRegistry([adapter]),
      resolveSecret: (name, projectId) =>
        name === 'forge-token' && projectId === project.id ? 'secret-token' : null,
    });
    return { approval, service, merges };
  }

  test('revalidates checks and merges through the source adapter', async () => {
    const { approval, service, merges } = setup('success');

    expect(await service.merge(approval)).toEqual({
      status: 'merged',
      detail: null,
    });
    expect(merges).toEqual([
      expect.objectContaining({
        externalKey: 'acme/demo',
        nativeKey: '42',
        token: 'secret-token',
        style: 'squash',
        deleteBranch: true,
        whenChecksSucceed: false,
      }),
    ]);
  });

  test('blocks when live checks are not green', async () => {
    const { approval, service, merges } = setup('failure');

    expect(await service.merge(approval)).toMatchObject({
      status: 'blocked',
      detail: 'Required checks are failure',
    });
    expect(merges).toHaveLength(0);
  });

  test('schedules native auto-merge without requiring green checks first', async () => {
    const { approval, service, merges } = setup('pending');
    const workItemId = approval.workItemId!;

    expect(
      await service.scheduleWhenChecksSucceed({
        projectId: approval.projectId,
        workItemId,
        style: 'squash',
      }),
    ).toEqual({ status: 'scheduled', detail: null });
    expect(merges).toEqual([
      expect.objectContaining({
        whenChecksSucceed: true,
        style: 'squash',
        deleteBranch: true,
        token: 'secret-token',
      }),
    ]);
  });
});