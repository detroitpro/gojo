/**
 * Reconcile external PR outcomes (merged/closed) after runs finish.
 * Self-contained: the scheduler only invokes `reconcile()`; providers are
 * pluggable so Forgejo/GitHub specifics stay behind one contract.
 */

import { runProcess } from '@/process/supervisor';
import type { Database } from '@/storage/db';
import { createRepositories } from '@/storage/repositories';
import type { RunIntegration } from '@/storage/types';

import { resolveForgejoToken } from './forgejo-auto-merge';

export type PrOutcomeState = 'open' | 'merged' | 'closed';

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

const INITIAL_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Stop polling a PR after roughly two weeks of 6-hour checks. */
const GIVE_UP_AFTER_CHECKS = 60;

/** Exponential backoff: 5m, 10m, 20m, … capped at 6h. */
export function computeNextCheckAt(checkCount: number, now: Date): string {
  const exponent = Math.max(0, Math.min(checkCount, 30));
  const interval = Math.min(
    INITIAL_CHECK_INTERVAL_MS * 2 ** exponent,
    MAX_CHECK_INTERVAL_MS,
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
  private readonly fetchStatus: FetchPrStatus;
  private readonly batchLimit: number;

  constructor(deps: { db: Database; fetchStatus?: FetchPrStatus; batchLimit?: number }) {
    this.repos = createRepositories(deps.db);
    this.fetchStatus = deps.fetchStatus ?? defaultFetchStatus;
    this.batchLimit = deps.batchLimit ?? 5;
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
        } else {
          this.repos.runIntegrations.update(integration.id, {
            checkCount,
            lastCheckedAt: nowIso,
            nextCheckAt:
              checkCount >= GIVE_UP_AFTER_CHECKS ? null : computeNextCheckAt(checkCount, now),
            lastError: null,
          });
        }
      } catch (error) {
        summary.errors += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.repos.runIntegrations.update(integration.id, {
          checkCount,
          lastCheckedAt: nowIso,
          nextCheckAt:
            checkCount >= GIVE_UP_AFTER_CHECKS ? null : computeNextCheckAt(checkCount, now),
          lastError: message,
        });
      }
    }

    return summary;
  }
}
