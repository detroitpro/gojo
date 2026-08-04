/**
 * Reconcile external PR outcomes (merged/closed) after runs finish.
 * Self-contained: the scheduler only invokes `reconcile()`; providers are
 * pluggable so Forgejo/GitHub specifics stay behind one contract.
 */

import { runProcess } from '@/infrastructure/process/supervisor';
import { PlatformChangeFeed } from '@/platform/events/platform-change-feed';
import type { Database } from '@/infrastructure/persistence/db';
import { createRepositories } from "@/platform/create-repositories";
import { createWorkRepositories } from '@/contexts/work/contract';
import type { RunIntegration } from '@/infrastructure/persistence/types';
import type { SourceChecksResult } from '@/contexts/work/contract';

export type PrOutcomeState = 'open' | 'merged' | 'closed';

function resolveForgejoToken(): string | null {
  return process.env['FORGEJO_TOKEN'] ?? process.env['GITEA_TOKEN'] ?? null;
}

export interface PrStatusResult {
  state: PrOutcomeState;
  mergedAt?: string | null;
  closedAt?: string | null;
}

/** Provider contract: resolve the live status of one tracked integration. */
export type FetchPrStatus = (integration: RunIntegration) => Promise<PrStatusResult>;

/** Parse a PR number from GitHub (`/pull/N`) or Forgejo/Gitea (`/pulls/N`) URLs. */
export function extractPrNumber(prUrl: string): number | null {
  const match = prUrl.match(/\/pulls?\/(\d+)(?:\/|$|\?|#)/i);
  if (!match?.[1]) {
    return null;
  }
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const ACTIVE_CHECK_INTERVAL_MS = 60 * 1000;
const MAX_ERROR_INTERVAL_MS = 15 * 60 * 1000;

/** Active resources remain verified on a fixed one-minute repair loop. */
export function computeNextCheckAt(_checkCount: number, now: Date): string {
  return new Date(now.getTime() + ACTIVE_CHECK_INTERVAL_MS).toISOString();
}

/** Errors back off independently, capped at fifteen minutes. */
export function computeErrorNextCheckAt(checkCount: number, now: Date): string {
  const exponent = Math.max(0, Math.min(checkCount, 4));
  const interval = Math.min(
    ACTIVE_CHECK_INTERVAL_MS * 2 ** exponent,
    MAX_ERROR_INTERVAL_MS,
  );
  return new Date(now.getTime() + interval).toISOString();
}

/** First reconciliation check for a newly opened PR. */
export function initialNextCheckAt(now: Date): string {
  return computeNextCheckAt(0, now);
}

interface ForgejoPrResponse {
  state?: string;
  merged?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
}

export async function fetchForgejoPrStatus(input: {
  apiUrl: string;
  repo: string;
  prNumber: number;
  token?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<PrStatusResult> {
  const base = input.apiUrl.trim().replace(/\/+$/, '');
  const repo = input.repo.trim().replace(/^\/+|\/+$/g, '');
  const token = input.token === undefined ? resolveForgejoToken() : input.token;

  const fetchFn = input.fetchImpl ?? fetch;
  const response = await fetchFn(
    `${base}/api/v1/repos/${repo}/pulls/${input.prNumber}`,
    {
      headers: {
        ...(token ? { Authorization: `token ${token}` } : {}),
        Accept: 'application/json',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Forgejo PR status failed (HTTP ${response.status})`);
  }

  const json = (await response.json()) as ForgejoPrResponse;
  if (json.merged) {
    return { state: 'merged', mergedAt: json.merged_at ?? null };
  }
  if (json.state === 'closed') {
    return { state: 'closed', closedAt: json.closed_at ?? null };
  }
  return { state: 'open' };
}

type RunProcessFn = typeof runProcess;

export async function fetchGithubPrStatus(input: {
  prUrl: string;
  cwd?: string;
  runProcessImpl?: RunProcessFn;
}): Promise<PrStatusResult> {
  const exec = input.runProcessImpl ?? runProcess;
  const result = await exec({
    command: 'gh',
    args: ['pr', 'view', input.prUrl, '--json', 'state,mergedAt,closedAt'],
    cwd: input.cwd ?? process.cwd(),
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh pr view failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
  }

  const json = JSON.parse(result.stdout) as {
    state?: string;
    mergedAt?: string | null;
    closedAt?: string | null;
  };
  const state = (json.state ?? '').toUpperCase();
  if (state === 'MERGED') {
    return { state: 'merged', mergedAt: json.mergedAt ?? null };
  }
  if (state === 'CLOSED') {
    return { state: 'closed', closedAt: json.closedAt ?? null };
  }
  return { state: 'open' };
}

function defaultFetchStatus(integration: RunIntegration): Promise<PrStatusResult> {
  if (integration.provider === 'forgejo') {
    if (!integration.apiUrl || !integration.repo || !integration.prNumber) {
      return Promise.reject(
        new Error('Forgejo reconciliation requires prApiUrl, prRepo, and a PR number'),
      );
    }
    return fetchForgejoPrStatus({
      apiUrl: integration.apiUrl,
      repo: integration.repo,
      prNumber: integration.prNumber,
    });
  }
  if (integration.provider === 'github') {
    if (!integration.prUrl) {
      return Promise.reject(new Error('GitHub reconciliation requires a PR URL'));
    }
    return fetchGithubPrStatus({ prUrl: integration.prUrl });
  }
  return Promise.reject(
    new Error(`No status provider for integration provider: ${integration.provider ?? 'none'}`),
  );
}

export interface ReconcileSummary {
  checked: number;
  merged: number;
  closed: number;
  errors: number;
}

export class IntegrationStatusReconciler {
  private readonly repos: ReturnType<typeof createRepositories>;
  private readonly work: ReturnType<typeof createWorkRepositories>;
  private readonly fetchStatus: FetchPrStatus;
  private readonly batchLimit: number;
  private readonly platformEvents: PlatformChangeFeed | null;
  private readonly fetchChecks:
    | ((integration: RunIntegration) => Promise<SourceChecksResult>)
    | null;
  private readonly onChecksSettled:
    | ((integration: RunIntegration, checks: SourceChecksResult) => Promise<void>)
    | null;

  constructor(deps: {
    db: Database;
    fetchStatus?: FetchPrStatus;
    batchLimit?: number;
    platformEvents?: PlatformChangeFeed;
    fetchChecks?: (integration: RunIntegration) => Promise<SourceChecksResult>;
    onChecksSettled?: (
      integration: RunIntegration,
      checks: SourceChecksResult,
    ) => Promise<void>;
  }) {
    this.repos = createRepositories(deps.db);
    this.work = createWorkRepositories(deps.db);
    this.fetchStatus = deps.fetchStatus ?? defaultFetchStatus;
    this.batchLimit = deps.batchLimit ?? 5;
    this.platformEvents = deps.platformEvents ?? null;
    this.fetchChecks = deps.fetchChecks ?? null;
    this.onChecksSettled = deps.onChecksSettled ?? null;
  }

  /** Check due, nonterminal integrations in one bounded batch. */
  async reconcile(now: Date = new Date()): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = { checked: 0, merged: 0, closed: 0, errors: 0 };
    const due = this.repos.runIntegrations.listDue(now.toISOString(), this.batchLimit);

    for (const integration of due) {
      summary.checked += 1;
      const nowIso = now.toISOString();
      const checkCount = integration.checkCount + 1;

      try {
        const status = await this.fetchStatus(integration);
        if (status.state === 'merged') {
          summary.merged += 1;
          this.repos.runIntegrations.update(integration.id, {
            status: 'merged',
            mergedAt: status.mergedAt ?? nowIso,
            checkCount,
            lastCheckedAt: nowIso,
            nextCheckAt: null,
            lastError: null,
          });
          this.updateLinkedWork(integration, {
            delivery: "merged",
            outcome: "succeeded",
            attention: "none",
            nativeState: "merged",
            syncState: "current",
            observedAt: nowIso,
            nextSyncAt: null,
            lastError: null,
            completedAt: status.mergedAt ?? nowIso,
          });
        } else if (status.state === 'closed') {
          summary.closed += 1;
          this.repos.runIntegrations.update(integration.id, {
            status: 'closed',
            closedAt: status.closedAt ?? nowIso,
            checkCount,
            lastCheckedAt: nowIso,
            nextCheckAt: null,
            lastError: null,
          });
          this.updateLinkedWork(integration, {
            delivery: "closed",
            outcome: "failed",
            attention: "none",
            nativeState: "closed",
            syncState: "current",
            observedAt: nowIso,
            nextSyncAt: null,
            lastError: null,
            completedAt: status.closedAt ?? nowIso,
          });
        } else {
          const checks = this.fetchChecks
            ? await this.fetchChecks(integration)
            : null;
          if (checks && checks.status !== 'pending') {
            await this.onChecksSettled?.(integration, checks);
          }
          const nextCheckAt = computeNextCheckAt(checkCount, now);
          this.repos.runIntegrations.update(integration.id, {
            checkCount,
            lastCheckedAt: nowIso,
            nextCheckAt,
            lastError: null,
          });
          this.updateLinkedWork(integration, {
            delivery: "open",
            attention: "none",
            nativeState: "open",
            syncState: "current",
            observedAt: nowIso,
            nextSyncAt: nextCheckAt,
            lastError: null,
          });
        }
      } catch (error) {
        summary.errors += 1;
        const message = error instanceof Error ? error.message : String(error);
        const nextCheckAt = computeErrorNextCheckAt(checkCount, now);
        this.repos.runIntegrations.update(integration.id, {
          checkCount,
          lastCheckedAt: nowIso,
          nextCheckAt,
          lastError: message,
        });
        this.updateLinkedWork(integration, {
          attention: "sync-error",
          syncState: "error",
          observedAt: nowIso,
          nextSyncAt: nextCheckAt,
          lastError: message,
        });
      }
    }

    return summary;
  }

  private updateLinkedWork(
    integration: RunIntegration,
    input: Parameters<ReturnType<typeof createWorkRepositories>["items"]["update"]>[1],
  ): void {
    const run = this.repos.runs.findById(integration.runId);
    if (!run) return;
    if (run.workItemId) {
      const delivery = this.work.links
        .listByWorkItem(run.workItemId)
        .find((link) => link.sourceWorkItemId === run.workItemId && link.type === "delivers");
      if (delivery) this.work.items.update(delivery.targetWorkItemId, input);
    }
    this.platformEvents?.append({
      projectId: run.projectId,
      type: 'integration.observed',
      entityKind: 'integration',
      entityId: integration.id,
      topics: ['dashboard', 'impact', 'projects', 'work'],
      data: input,
    });
  }
}
