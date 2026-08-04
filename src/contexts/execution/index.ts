import type { AppContext } from "@/platform/app-context";

import {
  InMemoryUnitOfWork,
  SystemClock,
  type Clock,
  type Outbox,
  type UnitOfWork,
} from "@/kernel";

import { approveRunCommand, rejectRunCommand } from "./application/approve-run";
import { cancelRunCommand } from "./application/cancel-run";
import {
  getRunArtifactsQuery,
  getRunDiffQuery,
  getRunQuery,
} from "./application/get-run";
import { listRunsQuery } from "./application/list-runs";
import { retryRunCommand } from "./application/retry-run";
import { updateRunProgressCommand } from "./application/update-progress";
import { AppContextCoordinatorAdapter } from "./infrastructure/coordinator-adapter";
import { SqliteRunReadModel } from "./infrastructure/sqlite-run-read-model";
import type { RunCoordinatorPort } from "./ports/run-coordinator";
import type { RunReadModel } from "./ports/run-read-model";

export * from "./contract";

export interface ExecutionModule {
  coordinator: RunCoordinatorPort;
  reads: RunReadModel;
  cancelRun: (runId: string) => ReturnType<typeof cancelRunCommand>;
  approveRun: (runId: string) => ReturnType<typeof approveRunCommand>;
  rejectRun: (runId: string, reason?: string | null) => ReturnType<typeof rejectRunCommand>;
  retryRun: (runId: string) => ReturnType<typeof retryRunCommand>;
  updateProgress: (
    runId: string,
    progress: {
      title: string;
      summary: string;
      blockedReason: string | null;
      references: string[];
    },
  ) => ReturnType<typeof updateRunProgressCommand>;
  getRun: (runId: string) => ReturnType<typeof getRunQuery>;
  getArtifacts: (runId: string) => ReturnType<typeof getRunArtifactsQuery>;
  getDiff: (runId: string) => ReturnType<typeof getRunDiffQuery>;
  listRuns: (
    query: Parameters<typeof listRunsQuery>[1],
  ) => ReturnType<typeof listRunsQuery>;
}

export function buildExecutionModule(deps: {
  ctx: AppContext;
  clock?: Clock;
  outbox?: Outbox;
  uow?: UnitOfWork;
}): ExecutionModule {
  const clock = deps.clock ?? new SystemClock();
  const uow = deps.uow ?? new InMemoryUnitOfWork();
  const coordinator = new AppContextCoordinatorAdapter(deps.ctx);
  const reads = new SqliteRunReadModel(deps.ctx);

  async function flushWith<T>(
    run: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    uow.clearEvents();
    const result = await run();
    if (result.ok && deps.outbox) {
      deps.outbox.publish(uow.events());
    }
    uow.clearEvents();
    return result;
  }

  return {
    coordinator,
    reads,
    cancelRun: (runId) =>
      flushWith(() => cancelRunCommand({ coordinator, reads, clock, uow }, { runId })),
    approveRun: (runId) =>
      flushWith(() => approveRunCommand({ coordinator, reads, clock, uow }, { runId })),
    rejectRun: (runId, reason) =>
      flushWith(() =>
        rejectRunCommand({ coordinator, reads, clock, uow }, {
          runId,
          reason: reason ?? null,
        }),
      ),
    retryRun: (runId) =>
      flushWith(() => retryRunCommand({ coordinator, reads, clock, uow }, { runId })),
    updateProgress: (runId, progress) =>
      flushWith(() =>
        updateRunProgressCommand(
          { coordinator, reads, clock, uow },
          { runId, ...progress },
        ),
      ),
    getRun: (runId) => getRunQuery({ reads }, { runId }),
    getArtifacts: (runId) => getRunArtifactsQuery({ reads }, { runId }),
    getDiff: (runId) => getRunDiffQuery({ reads }, { runId }),
    listRuns: (query) => listRunsQuery({ reads }, query),
  };
}
