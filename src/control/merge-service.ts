import type { Approval } from '@shared/approvals';
import { parseJsonObject } from '@shared/json';
import { MergeQueue } from '@/integration/queue';
import {
  SourceAdapterRegistry,
  defaultSourceAdapters,
} from '@/sources';
import { createWorkRepositories } from '@/storage';
import type { Database } from '@/storage/db';

import type { MergeResult } from './service';

export class MergeService {
  private readonly work;
  private readonly registry: SourceAdapterRegistry;
  private readonly resolveSecret:
    | ((name: string, projectId: string) => string | null)
    | null;
  private readonly queue: MergeQueue;

  constructor(input: {
    db: Database;
    registry?: SourceAdapterRegistry;
    resolveSecret?: (name: string, projectId: string) => string | null;
    queue?: MergeQueue;
  }) {
    this.work = createWorkRepositories(input.db);
    this.registry =
      input.registry ?? new SourceAdapterRegistry(defaultSourceAdapters());
    this.resolveSecret = input.resolveSecret ?? null;
    this.queue = input.queue ?? new MergeQueue();
  }

  async merge(approval: Approval): Promise<MergeResult> {
    if (approval.subjectType !== 'pull-request') {
      return { status: 'blocked', detail: 'Approval subject is not a pull request' };
    }
    const resolved = this.resolvePullRequestTarget(
      approval.projectId,
      approval.workItemId ?? approval.subjectId,
    );
    if (!resolved.ok) {
      return { status: 'blocked', detail: resolved.detail };
    }
    const { adapter, operation } = resolved;

    return this.queue.withLock(approval.projectId, async () => {
      if (!adapter.getChecks || !adapter.mergePullRequest) {
        return {
          status: 'blocked' as const,
          detail: `Source adapter ${adapter.type} cannot merge pull requests`,
        };
      }
      const checks = await adapter.getChecks(operation);
      if (checks.status !== 'success') {
        return {
          status: 'blocked' as const,
          detail: `Required checks are ${checks.status}`,
        };
      }
      const mergeStyle =
        approval.evidence['mergeStyle'] === 'merge' ||
        approval.evidence['mergeStyle'] === 'rebase'
          ? approval.evidence['mergeStyle']
          : 'squash';
      const result = await adapter.mergePullRequest({
        ...operation,
        style: mergeStyle,
        deleteBranch: true,
        whenChecksSucceed: false,
      });
      return { status: result.status, detail: result.detail };
    });
  }

  /**
   * Ask the forge to merge once required checks succeed (native auto-merge).
   * Does not wait for checks to be green first.
   */
  async scheduleWhenChecksSucceed(input: {
    projectId: string;
    workItemId: string;
    style?: 'squash' | 'merge' | 'rebase';
  }): Promise<MergeResult> {
    const resolved = this.resolvePullRequestTarget(input.projectId, input.workItemId);
    if (!resolved.ok) {
      return { status: 'blocked', detail: resolved.detail };
    }
    const { adapter, operation } = resolved;
    if (!adapter.mergePullRequest) {
      return {
        status: 'blocked',
        detail: `Source adapter ${adapter.type} cannot merge pull requests`,
      };
    }
    return this.queue.withLock(input.projectId, async () => {
      const result = await adapter.mergePullRequest!({
        ...operation,
        style: input.style ?? 'squash',
        deleteBranch: true,
        whenChecksSucceed: true,
      });
      return { status: result.status, detail: result.detail };
    });
  }

  private resolvePullRequestTarget(
    projectId: string,
    workItemId: string,
  ):
    | {
        ok: true;
        adapter: NonNullable<ReturnType<SourceAdapterRegistry['get']>>;
        operation: {
          baseUrl: string;
          externalKey: string;
          kind: 'pull-request';
          nativeKey: string;
          token: string;
        };
      }
    | { ok: false; detail: string } {
    const workItem = this.work.items.findById(workItemId);
    if (
      !workItem ||
      workItem.projectId !== projectId ||
      workItem.kind !== 'pull-request' ||
      !workItem.sourceId ||
      !workItem.nativeKey
    ) {
      return { ok: false, detail: 'Pull request work item is incomplete' };
    }
    const source = this.work.sources.findById(workItem.sourceId);
    const connection = source?.connectionId
      ? this.work.connections.findById(source.connectionId)
      : null;
    if (!source || !connection) {
      return { ok: false, detail: 'Source connection is not configured' };
    }
    const adapter = this.registry.get(connection.adapter);
    if (!adapter) {
      return {
        ok: false,
        detail: `Source adapter ${connection.adapter} cannot merge pull requests`,
      };
    }
    const config = parseJsonObject(connection.configJson);
    const secretName =
      typeof config['tokenSecretName'] === 'string'
        ? config['tokenSecretName']
        : null;
    const token =
      (secretName
        ? this.resolveSecret?.(secretName, projectId) ?? null
        : null) ?? defaultToken(connection.adapter);
    if (!token) {
      return { ok: false, detail: 'Source write token is not configured' };
    }
    return {
      ok: true,
      adapter,
      operation: {
        baseUrl: connection.baseUrl ?? '',
        externalKey: source.externalKey,
        kind: 'pull-request',
        nativeKey: workItem.nativeKey,
        token,
      },
    };
  }

  async getDiff(projectId: string, workItemId: string): Promise<string> {
    const workItem = this.work.items.findById(workItemId);
    if (
      !workItem ||
      workItem.projectId !== projectId ||
      workItem.kind !== 'pull-request' ||
      !workItem.sourceId ||
      !workItem.nativeKey
    ) {
      throw new Error('Pull request work item is incomplete');
    }
    const source = this.work.sources.findById(workItem.sourceId);
    const connection = source?.connectionId
      ? this.work.connections.findById(source.connectionId)
      : null;
    const adapter = connection ? this.registry.get(connection.adapter) : null;
    if (!source || !connection || !adapter?.getDiff) {
      throw new Error('Source adapter cannot provide pull request diffs');
    }
    const config = parseJsonObject(connection.configJson);
    const secretName =
      typeof config['tokenSecretName'] === 'string' ? config['tokenSecretName'] : null;
    const token =
      (secretName ? this.resolveSecret?.(secretName, projectId) ?? null : null) ??
      defaultToken(connection.adapter);
    return adapter.getDiff({
      baseUrl: connection.baseUrl ?? '',
      externalKey: source.externalKey,
      kind: 'pull-request',
      nativeKey: workItem.nativeKey,
      token,
    });
  }

  async getChecks(projectId: string, workItemId: string) {
    const workItem = this.work.items.findById(workItemId);
    if (
      !workItem ||
      workItem.projectId !== projectId ||
      workItem.kind !== 'pull-request' ||
      !workItem.sourceId ||
      !workItem.nativeKey
    ) {
      throw new Error('Pull request work item is incomplete');
    }
    const source = this.work.sources.findById(workItem.sourceId);
    const connection = source?.connectionId
      ? this.work.connections.findById(source.connectionId)
      : null;
    const adapter = connection ? this.registry.get(connection.adapter) : null;
    if (!source || !connection || !adapter?.getChecks) {
      throw new Error('Source adapter cannot provide pull request checks');
    }
    const config = parseJsonObject(connection.configJson);
    const secretName =
      typeof config['tokenSecretName'] === 'string' ? config['tokenSecretName'] : null;
    const token =
      (secretName ? this.resolveSecret?.(secretName, projectId) ?? null : null) ??
      defaultToken(connection.adapter);
    return adapter.getChecks({
      baseUrl: connection.baseUrl ?? '',
      externalKey: source.externalKey,
      kind: 'pull-request',
      nativeKey: workItem.nativeKey,
      token,
    });
  }

  async getPullRequestState(
    projectId: string,
    workItemId: string,
  ): Promise<{ state: "open" | "merged" | "closed" }> {
    const workItem = this.work.items.findById(workItemId);
    if (
      !workItem ||
      workItem.projectId !== projectId ||
      workItem.kind !== "pull-request" ||
      !workItem.sourceId ||
      !workItem.nativeKey
    ) {
      throw new Error("Pull request work item is incomplete");
    }
    const source = this.work.sources.findById(workItem.sourceId);
    const connection = source?.connectionId
      ? this.work.connections.findById(source.connectionId)
      : null;
    const adapter = connection ? this.registry.get(connection.adapter) : null;
    if (!source || !connection || !adapter?.getItem) {
      throw new Error("Source adapter cannot inspect pull request state");
    }
    const config = parseJsonObject(connection.configJson);
    const secretName =
      typeof config["tokenSecretName"] === "string"
        ? config["tokenSecretName"]
        : null;
    const token =
      (secretName
        ? this.resolveSecret?.(secretName, projectId) ?? null
        : null) ?? defaultToken(connection.adapter);
    const result = await adapter.getItem({
      baseUrl: connection.baseUrl ?? "",
      externalKey: source.externalKey,
      kind: "pull-request",
      nativeKey: workItem.nativeKey,
      token,
    });
    if (result.status !== "found") {
      throw new Error(result.detail);
    }
    return {
      state:
        result.item.delivery === "merged"
          ? "merged"
          : result.item.delivery === "closed"
            ? "closed"
            : "open",
    };
  }
}

function defaultToken(adapter: string): string | null {
  if (adapter === 'github') {
    return process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN'] ?? null;
  }
  if (adapter === 'forgejo') {
    return process.env['FORGEJO_TOKEN'] ?? process.env['GITEA_TOKEN'] ?? null;
  }
  if (adapter === 'gitlab') return process.env['GITLAB_TOKEN'] ?? null;
  return null;
}
