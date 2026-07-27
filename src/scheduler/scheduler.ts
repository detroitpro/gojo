import { createRepositories } from "@/storage";
import type { Database } from "@/storage";
import { isInstancePaused } from "@/storage/instance-settings";
import {
  acquireSchedulerLease,
  refreshSchedulerLease,
  releaseSchedulerLease,
} from "@/storage/scheduler-leases";
import type { Schedule } from "@/storage/types";

import { missedOccurrences, nextOccurrence } from "./cron";
import {
  type MissedRunPolicy,
  type OverlapPolicy,
  selectMissedRuns,
  shouldStartGivenOverlap,
} from "./policies";

const LEASE_ID = "primary";
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 60_000;

export interface SchedulerDeps {
  db: Database;
  onTrigger: (scheduleId: string, fireAt: Date) => Promise<void>;
  /** Cancel non-terminal runs for a schedule (cancel_replace overlap policy). */
  onCancelActive?: (scheduleId: string) => Promise<void>;
  leaseHolderId: string;
  isPaused?: () => boolean;
  tickIntervalMs?: number;
  leaseTtlMs?: number;
  /**
   * Optional integration-outcome reconciliation invoked once per tick while
   * the lease is held. The scheduler only invokes it; the integration-status
   * module owns batching, backoff, and provider logic.
   */
  reconcileIntegrations?: (now: Date) => Promise<unknown>;
}

function parsePolicy<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export class Scheduler {
  private readonly db: Database;
  private readonly onTrigger: (scheduleId: string, fireAt: Date) => Promise<void>;
  private readonly onCancelActive: ((scheduleId: string) => Promise<void>) | null;
  private readonly leaseHolderId: string;
  private readonly isPausedFn: () => boolean;
  private readonly tickIntervalMs: number;
  private readonly leaseTtlMs: number;
  private readonly reconcileIntegrations: ((now: Date) => Promise<unknown>) | null;
  private readonly repos;
  private timer: ReturnType<typeof setInterval> | null = null;
  private leaseHeld = false;

  constructor(deps: SchedulerDeps) {
    this.db = deps.db;
    this.repos = createRepositories(deps.db);
    this.onTrigger = deps.onTrigger;
    this.onCancelActive = deps.onCancelActive ?? null;
    this.leaseHolderId = deps.leaseHolderId;
    this.isPausedFn = deps.isPaused ?? (() => isInstancePaused(deps.db));
    this.tickIntervalMs = deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.leaseTtlMs = deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.reconcileIntegrations = deps.reconcileIntegrations ?? null;
  }

  async start(): Promise<void> {
    this.leaseHeld = await this.acquireLease(this.leaseTtlMs);
    if (!this.leaseHeld) {
      return;
    }

    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.leaseHeld) {
      this.releaseLease();
      this.leaseHeld = false;
    }
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (!this.leaseHeld) {
      this.leaseHeld = await this.acquireLease(this.leaseTtlMs);
      if (!this.leaseHeld) {
        return;
      }
    } else {
      const refreshed = await this.refreshLease(this.leaseTtlMs);
      if (!refreshed) {
        this.leaseHeld = false;
        return;
      }
    }

    // Outcome reconciliation is passive (reads external PR state) and keeps
    // running while the instance is paused so merge accounting stays current.
    if (this.reconcileIntegrations) {
      try {
        await this.reconcileIntegrations(now);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          JSON.stringify({
            level: "error",
            component: "scheduler",
            phase: "integration-reconcile",
            error: message,
          }),
        );
      }
    }

    if (this.isPausedFn()) {
      return;
    }

    const nowIso = now.toISOString();
    const dueSchedules = this.repos.schedules.listDue(nowIso);

    for (const schedule of dueSchedules) {
      await this.processDueSchedule(schedule, now);
    }
  }

  async acquireLease(ttlMs: number): Promise<boolean> {
    return acquireSchedulerLease(this.db, LEASE_ID, this.leaseHolderId, ttlMs);
  }

  async refreshLease(ttlMs: number): Promise<boolean> {
    return refreshSchedulerLease(this.db, LEASE_ID, this.leaseHolderId, ttlMs);
  }

  private releaseLease(): void {
    releaseSchedulerLease(this.db, LEASE_ID, this.leaseHolderId);
  }

  private async processDueSchedule(schedule: Schedule, now: Date): Promise<void> {
    const overlapPolicy = parsePolicy<OverlapPolicy>(
      schedule.overlapPolicy,
      ["skip", "queue", "cancel_replace", "allow_parallel"],
      "skip",
    );
    const missedRunPolicy = parsePolicy<MissedRunPolicy>(
      schedule.missedRunPolicy,
      ["skip", "run_once", "run_all", "run_latest"],
      "run_latest",
    );

    const anchor = schedule.lastRunAt
      ? new Date(schedule.lastRunAt)
      : schedule.nextRunAt
        ? new Date(schedule.nextRunAt)
        : now;

    const missed = missedOccurrences(schedule.cronExpr, schedule.timezone, anchor, now);
    const fireTimes = selectMissedRuns(missedRunPolicy, missed);

    if (fireTimes.length === 0 && schedule.nextRunAt && new Date(schedule.nextRunAt) <= now) {
      fireTimes.push(new Date(schedule.nextRunAt));
    }

    let lastFiredAt: Date | null = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null;

    for (const fireAt of fireTimes) {
      const hasActiveRun = this.repos.runs.countActiveBySchedule(schedule.id) > 0;
      const queuedCount = this.repos.runs.countQueuedBySchedule(schedule.id);
      const decision = shouldStartGivenOverlap(overlapPolicy, hasActiveRun, queuedCount);

      if (decision === "skip") {
        continue;
      }

      if (decision === "cancel_replace") {
        if (this.onCancelActive) {
          await this.onCancelActive(schedule.id);
        }
      }

      // "start", "queue", and post-cancel "cancel_replace" all enqueue a run.
      await this.onTrigger(schedule.id, fireAt);
      lastFiredAt = fireAt;
    }

    const nextFrom = lastFiredAt ?? now;
    const nextRun = nextOccurrence(schedule.cronExpr, schedule.timezone, nextFrom);
    const nextRunAt = (nextRun ?? nextOccurrence(schedule.cronExpr, schedule.timezone, now))?.toISOString() ?? null;
    const lastRunAt = lastFiredAt?.toISOString() ?? schedule.lastRunAt;

    this.repos.schedules.updateNextRun(schedule.id, nextRunAt, lastRunAt);
  }
}
