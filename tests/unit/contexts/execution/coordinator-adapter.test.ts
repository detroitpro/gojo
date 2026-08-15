import { describe, expect, mock, test } from "bun:test";

import { AppContextCoordinatorAdapter } from "@/contexts/execution/infrastructure/coordinator-adapter";
import type { AppContext } from "@/platform/app-context";
import type { Run } from "@shared/entities";
import { RunState } from "@shared/run-states";

function runStub(partial: Partial<Run> & Pick<Run, "id" | "projectId" | "agentId" | "state">): Run {
  return {
    scheduleId: null,
    idempotencyKey: "idem-1",
    trigger: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    notBeforeAt: null,
    expiresAt: null,
    admittedAt: null,
    priority: 30,
    workItemId: null,
    ...partial,
  };
}

function adapterWithCoordinator(
  coordinator: Partial<AppContext["coordinator"]>,
): AppContextCoordinatorAdapter {
  return new AppContextCoordinatorAdapter({
    coordinator: coordinator as AppContext["coordinator"],
  } as AppContext);
}

describe("AppContextCoordinatorAdapter", () => {
  test("enqueueRun maps coordinator run to id and state", async () => {
    const enqueueRun = mock(async () =>
      runStub({
        id: "run_1",
        state: RunState.Queued,
        projectId: "prj_1",
        agentId: "agt_1",
      }),
    );

    const result = await adapterWithCoordinator({ enqueueRun }).enqueueRun({
      projectId: "prj_1",
      agentId: "agt_1",
      trigger: "manual",
      idempotencyKey: "idem-1",
    });

    expect(result).toEqual({ id: "run_1", state: RunState.Queued });
    expect(enqueueRun).toHaveBeenCalledWith({
      projectId: "prj_1",
      agentId: "agt_1",
      trigger: "manual",
      idempotencyKey: "idem-1",
    });
  });

  test("rejectRun passes undefined when reason is null", async () => {
    const rejectRun = mock(async () => {});
    const cancelRun = mock(async () => {});
    const approveRun = mock(async () => {});

    const adapter = adapterWithCoordinator({ rejectRun, cancelRun, approveRun });
    await adapter.rejectRun("run_1", null);
    await adapter.cancelRun("run_1");
    await adapter.approveRun("run_1");

    expect(rejectRun).toHaveBeenCalledWith("run_1", undefined);
    expect(cancelRun).toHaveBeenCalledWith("run_1");
    expect(approveRun).toHaveBeenCalledWith("run_1");
  });

  test("updateProgress, executeRun, and syncWorkFromRun delegate to coordinator", async () => {
    const run = runStub({
      id: "run_1",
      state: RunState.Running,
      projectId: "prj_1",
      agentId: "agt_1",
    });
    const updateProgress = mock(() => run);
    const executeRun = mock(async () => run);
    const syncWorkFromRun = mock(() => {});

    const adapter = adapterWithCoordinator({ updateProgress, executeRun, syncWorkFromRun });
    const progress = {
      title: "Testing",
      summary: "Adapter delegation",
      blockedReason: null,
      references: [],
    };

    expect(adapter.updateProgress("run_1", progress)).toEqual({
      id: "run_1",
      state: RunState.Running,
      projectId: "prj_1",
      agentId: "agt_1",
    });
    expect(updateProgress).toHaveBeenCalledWith("run_1", progress);

    await expect(adapter.executeRun("run_1")).resolves.toEqual(run);
    adapter.syncWorkFromRun(run);
    expect(syncWorkFromRun).toHaveBeenCalledWith(run);
  });
});
