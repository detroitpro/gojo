import type { AppContext } from "@/platform/app-context";
import { readSchedulingPolicy } from "@/contexts/scheduling/contract";
import {
  DEFAULT_PAGE_LIMIT,
  paginateArray,
  compareSortValues,
} from "@shared/pagination";
import { compareWindowToMs, parseCompareWindow } from "@shared/work";
import { getDashboardOverview } from "@/contexts/operations/infrastructure/dashboard-overview";
import { getDashboardImpact, parseImpactRange } from "@/contexts/operations/infrastructure/impact-analytics";
import { createWorkStatusRollup } from "@/contexts/work/contract";

import type {
  DashboardImpact,
  DashboardOverview,
  DashboardReadModel,
  DashboardSummary,
  QueueSnapshot,
} from "../ports/dashboard-read-model";

const RUNNING_ROLLUP_STATES = new Set([
  "Preparing",
  "Running",
  "Validating",
  "AwaitingApproval",
  "Integrating",
  "Reporting",
]);

export class AppContextDashboardReadModel implements DashboardReadModel {
  constructor(private readonly ctx: AppContext) {}

  summary(compare: string): DashboardSummary {
    const ctx = this.ctx;
    const compareWindow = parseCompareWindow(compare);
    const projectRows = ctx.repos.projects.list();
    const projects = projectRows.length;
    const enabledProjects = projectRows.filter((project) => project.enabled).length;
    const agents = ctx.repos.agents.count();
    const enabledAgents = ctx.repos.agents.countEnabled();
    const schedules = ctx.repos.schedules.count();
    const enabledSchedules = ctx.repos.schedules.countEnabled();
    const runs = ctx.repos.runs.count();
    const activeRuns = ctx.repos.runs.listNonTerminal().length;
    const waitingRuns = ctx.repos.runs.listQueued().length;
    const runningByProject = ctx.repos.runs.countRunningByProject();
    const runningRuns = Object.values(runningByProject).reduce((a, b) => a + b, 0);
    // @removal(when: queue/dashboard reads move onto scheduling context): R7
    const policy = readSchedulingPolicy(ctx.db);

    const previousAsOf = new Date(
      Date.now() - compareWindowToMs(compareWindow),
    ).toISOString();
    const rollup = createWorkStatusRollup(ctx.db);
    const hasRunHistory =
      ctx.db
        .connection()
        .query<{ n: number }, []>(
          `SELECT COUNT(*) AS n FROM work_events
           WHERE execution IS NOT NULL
             AND json_extract(data_json, '$.kind') = 'run'`,
        )
        .get()?.n ?? 0;
    const previousRunCounts =
      hasRunHistory > 0 ? rollup.countsAtKind("run", previousAsOf) : null;
    const previousRunsTotal =
      ctx.db
        .connection()
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM runs WHERE created_at <= ?",
        )
        .get(previousAsOf)?.n ?? 0;

    return {
      projects,
      enabledProjects,
      agents,
      enabledAgents,
      schedules,
      enabledSchedules,
      runs,
      activeRuns,
      runningRuns,
      waitingRuns,
      schedulingPolicy: policy,
      paused: ctx.isPaused(),
      previous: previousRunCounts
        ? {
            runningRuns: previousRunCounts.working,
            waitingRuns: previousRunCounts.queued,
            runs: previousRunsTotal,
            asOf: previousAsOf,
            compareWindow,
          }
        : null,
    };
  }

  overview(): DashboardOverview {
    return getDashboardOverview(this.ctx.db) as unknown as DashboardOverview;
  }

  impact(input: {
    projectId?: string | null;
    from?: string | null;
    to?: string | null;
    range?: string | null;
  }): DashboardImpact {
    return getDashboardImpact(this.ctx.db, {
      projectId: input.projectId ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
      range: parseImpactRange(input.range ?? null),
    }) as unknown as DashboardImpact;
  }

  queue(input: {
    limit: number;
    offset: number;
    sort: string;
    order: "asc" | "desc";
  }): QueueSnapshot {
    const ctx = this.ctx;
    const policy = readSchedulingPolicy(ctx.db);
    const queued = ctx.repos.runs.listQueued();
    const runningByProject = ctx.repos.runs.countRunningByProject();
    const runningCount = Object.values(runningByProject).reduce((a, b) => a + b, 0);
    const waitingRows = queued.map((run, index) => {
      const project = ctx.repos.projects.findById(run.projectId);
      const agent = ctx.repos.agents.findById(run.agentId);
      return {
        runId: run.id,
        projectId: run.projectId,
        projectName: project?.name ?? null,
        agentId: run.agentId,
        agentName: agent?.name ?? null,
        trigger: run.trigger,
        priority: run.priority,
        notBeforeAt: run.notBeforeAt,
        expiresAt: run.expiresAt,
        createdAt: run.createdAt,
        position: index + 1,
      };
    });
    const sortedWaiting = [...waitingRows].sort((a, b) => {
      const key = input.sort as keyof typeof a;
      return compareSortValues(a[key], b[key], input.order);
    });
    const paged = paginateArray(sortedWaiting, { limit: input.limit, offset: input.offset });
    const running = ctx.repos.runs
      .listNonTerminal()
      .filter((run) => RUNNING_ROLLUP_STATES.has(run.state))
      .map((run) => {
        const project = ctx.repos.projects.findById(run.projectId);
        const agent = ctx.repos.agents.findById(run.agentId);
        return {
          runId: run.id,
          projectId: run.projectId,
          projectName: project?.name ?? null,
          agentId: run.agentId,
          agentName: agent?.name ?? null,
          state: run.state,
          admittedAt: run.admittedAt,
        };
      });

    return {
      policy,
      counts: { running: runningCount, waiting: waitingRows.length },
      waiting: paged.items,
      total: paged.total,
      limit: paged.limit,
      offset: paged.offset,
      running,
    };
  }
}

export { DEFAULT_PAGE_LIMIT };
