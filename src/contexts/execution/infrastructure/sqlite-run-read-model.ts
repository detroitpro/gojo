import type { AppContext } from "@/platform/app-context";
import { getRunArtifacts } from "@/contexts/execution/application/inspect";
import { getRunDiff } from "@/contexts/execution/infrastructure/run-workspace-diff";
import { listRunsPage } from "@/contexts/execution/infrastructure/run-paged-lists";

import type {
  RunArtifactsRead,
  RunDetail,
  RunDiffRead,
  RunListPage,
  RunListQuery,
  RunReadModel,
} from "../ports/run-read-model";

type RunLike = {
  id: string;
  projectId: string;
  agentId: string;
  scheduleId: string | null;
  state: string;
  idempotencyKey: string;
  trigger: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
};

function enrichRun(
  ctx: AppContext,
  run: RunLike,
): RunDetail["run"] {
  const project = ctx.repos.projects.findById(run.projectId);
  const agent = ctx.repos.agents.findById(run.agentId);
  return {
    ...run,
    projectName: project?.name ?? null,
    agentName: agent?.name ?? null,
  };
}

/**
 * Read model backed by the current SQLite repos + fs artifact tree.
 * Isolates transport code from repo/artifact plumbing so the execution
 * context can migrate incrementally.
 */
export class SqliteRunReadModel implements RunReadModel {
  constructor(private readonly ctx: AppContext) {}

  list(query: RunListQuery): RunListPage {
    const result = listRunsPage(this.ctx.db, {
      limit: query.limit,
      offset: query.offset,
      sort: query.sort,
      order: query.order,
      projectId: query.projectId ?? null,
      agentId: query.agentId ?? null,
      state: query.state ?? null,
      trigger: query.trigger ?? null,
      q: query.q ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
    });
    return {
      items: result.items.map((item) => ({
        id: item.id,
        projectId: item.projectId,
        agentId: item.agentId,
        scheduleId: item.scheduleId,
        state: item.state,
        idempotencyKey: item.idempotencyKey,
        trigger: item.trigger,
        createdAt: item.createdAt,
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        errorMessage: item.errorMessage,
        projectName: item.projectName ?? null,
        agentName: item.agentName ?? null,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  detail(runId: string): RunDetail | null {
    const run = this.ctx.repos.runs.findById(runId);
    if (!run) {
      return null;
    }
    const attempts = this.ctx.repos.attempts.listByRun(runId);
    return {
      run: enrichRun(this.ctx, run),
      attempts,
      impactItems: this.ctx.repos.runImpactItems.listByRun(runId),
      integration: this.ctx.repos.runIntegrations.findByRun(runId),
      approval: this.ctx.approvals.findByRun(runId),
    };
  }

  artifacts(runId: string): RunArtifactsRead {
    return getRunArtifacts(this.ctx, runId);
  }

  async diff(runId: string): Promise<RunDiffRead> {
    return getRunDiff(this.ctx, runId);
  }
}
