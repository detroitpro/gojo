import { cpus, loadavg } from 'node:os';

import { isTerminal, RunState } from '@shared/run-states';

import { getSchedulingPolicy } from '@/app/instance-settings';
import type { Database } from '@/storage/db';
import { createRepositories } from '@/storage/repositories';

import { selectAdmissions } from './admission';
import type { RunCoordinator } from './coordinator';

const DEFAULT_TICK_MS = 5_000;

export interface RunDispatcherDeps {
  db: Database;
  coordinator: RunCoordinator;
  tickIntervalMs?: number;
  /** Injected for tests. Defaults to os.loadavg()[0] / cpus().length. */
  loadPerCpu?: () => number;
  now?: () => Date;
}

export class RunDispatcher {
  private readonly db: Database;
  private readonly coordinator: RunCoordinator;
  private readonly repos;
  private readonly tickIntervalMs: number;
  private readonly loadPerCpu: () => number;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(deps: RunDispatcherDeps) {
    this.db = deps.db;
    this.coordinator = deps.coordinator;
    this.repos = createRepositories(deps.db);
    this.tickIntervalMs = deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.loadPerCpu =
      deps.loadPerCpu ??
      (() => {
        const cpuCount = Math.max(cpus().length, 1);
        return loadavg()[0]! / cpuCount;
      });
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Kick admission immediately (e.g. after a run finishes). */
  kick(): void {
    void this.tick();
  }

  async tick(now = this.now()): Promise<{ admitted: string[]; expired: string[] }> {
    if (this.ticking) {
      return { admitted: [], expired: [] };
    }
    this.ticking = true;
    try {
      const policy = getSchedulingPolicy(this.db);
      const queued = this.repos.runs.listQueued();
      const runningByProject = this.repos.runs.countRunningByProject();
      // Count admitted-but-still-queued as occupying a slot (executeRun is async).
      for (const run of queued) {
        if (!run.admittedAt) {
          continue;
        }
        runningByProject[run.projectId] = (runningByProject[run.projectId] ?? 0) + 1;
      }
      const latest = this.repos.runs.latestAdmittedAt();

      // Skip runs already handed to executeRun but not yet left Queued/Scheduled
      // (fire-and-forget leaves a race window on the next tick).
      const waiting = queued.filter((run) => !run.admittedAt);

      const decision = selectAdmissions(
        {
          queued: waiting.map((run) => ({
            id: run.id,
            projectId: run.projectId,
            priority: run.priority,
            notBeforeAt: run.notBeforeAt ?? run.createdAt,
            expiresAt: run.expiresAt,
            createdAt: run.createdAt,
          })),
          runningByProject,
          lastAdmittedAt: latest ? new Date(latest) : null,
          loadPerCpu: this.loadPerCpu(),
        },
        policy,
        now,
      );

      for (const runId of decision.expire) {
        const run = this.repos.runs.findById(runId);
        if (!run || (run.state !== RunState.Queued && run.state !== RunState.Scheduled)) {
          continue;
        }
        this.repos.runs.update(runId, {
          state: RunState.Skipped,
          finishedAt: now.toISOString(),
          errorMessage: 'Expired waiting for an admission slot (past next cron occurrence)',
        });
        const updated = this.repos.runs.findById(runId);
        if (updated) this.coordinator.syncWorkFromRun(updated);
      }

      const admitted: string[] = [];
      for (const runId of decision.admit) {
        const run = this.repos.runs.findById(runId);
        if (!run || (run.state !== RunState.Queued && run.state !== RunState.Scheduled)) {
          continue;
        }
        this.repos.runs.update(runId, {
          admittedAt: now.toISOString(),
          ...(run.state === RunState.Scheduled ? { state: RunState.Queued } : {}),
        });
        admitted.push(runId);
        void this.coordinator.executeRun(runId).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            JSON.stringify({
              level: 'error',
              component: 'dispatcher',
              runId,
              error: message,
            }),
          );
        });
      }

      return { admitted, expired: decision.expire };
    } finally {
      this.ticking = false;
    }
  }

  /** Poll until a run reaches a terminal state (CLI UX). */
  async waitForTerminal(
    runId: string,
    options?: { pollMs?: number; maxMs?: number },
  ): Promise<void> {
    const pollMs = options?.pollMs ?? 1_000;
    const maxMs = options?.maxMs ?? 60 * 60 * 1000;
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      await this.tick();
      const run = this.repos.runs.findById(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }
      if (isTerminal(run.state)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error(`Timed out waiting for run ${runId} to finish`);
  }
}
