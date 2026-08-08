import { describe, expect, mock, test } from "bun:test";

import { approveRunCommand, rejectRunCommand } from "@/contexts/execution/application/approve-run";
import { cancelRunCommand } from "@/contexts/execution/application/cancel-run";
import { getRunDiffQuery, getRunQuery } from "@/contexts/execution/application/get-run";
import { retryRunCommand } from "@/contexts/execution/application/retry-run";
import type { RunCoordinatorPort } from "@/contexts/execution/ports/run-coordinator";
import type { RunDetail, RunReadModel } from "@/contexts/execution/ports/run-read-model";
import { FixedClock, InMemoryUnitOfWork } from "@/kernel";
import { RunState } from "@shared/run-states";

const clock = () => new FixedClock(new Date("2026-01-01T00:00:00.000Z"));

function runDetail(
  partial: Partial<RunDetail["run"]> & {
    id: string;
    projectId: string;
    agentId: string;
    state: string;
  },
): RunDetail {
  return {
    run: {
      scheduleId: null,
      idempotencyKey: "idem-1",
      trigger: "manual",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      projectName: "demo",
      agentName: "task",
      ...partial,
    },
    attempts: [],
    impactItems: [],
    integration: null,
    approval: null,
  };
}

function stubReads(over: Partial<RunReadModel>): RunReadModel {
  const base: RunReadModel = {
    list: () => {
      throw new Error("list not implemented");
    },
    detail: () => null,
    artifacts: () => ({ path: "/tmp", exists: false, handoff: null, validation: null, failure: null }),
    diff: async () => ({ files: [] }),
  };
  return { ...base, ...over };
}

describe("execution run commands", () => {
  test("retryRunCommand returns err when run is missing", async () => {
    const result = await retryRunCommand(
      {
        coordinator: {} as RunCoordinatorPort,
        reads: stubReads({}),
        clock: clock(),
        uow: new InMemoryUnitOfWork(),
      },
      { runId: "run_missing" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("run not found");
    }
  });

  test("retryRunCommand enqueues a manual retry and emits execution.run.retried", async () => {
    const uow = new InMemoryUnitOfWork();
    const detail = runDetail({
      id: "run_old",
      projectId: "prj_1",
      agentId: "agt_1",
      state: RunState.Failed,
    });
    const enqueueRun = mock(async () => ({ id: "run_new", state: RunState.Queued }));

    const result = await retryRunCommand(
      {
        coordinator: { enqueueRun } as unknown as RunCoordinatorPort,
        reads: stubReads({ detail: () => detail }),
        clock: clock(),
        uow,
      },
      { runId: "run_old" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.run).toEqual({ id: "run_new", state: RunState.Queued });
    }
    expect(enqueueRun).toHaveBeenCalledWith({
      projectId: "prj_1",
      agentId: "agt_1",
      trigger: "manual",
    });
    expect(uow.events()).toHaveLength(1);
    expect(uow.events()[0]?.type).toBe("execution.run.retried");
    expect(uow.events()[0]?.data).toEqual({ retryOf: "run_old" });
  });

  test("cancelRunCommand rejects terminal runs and cancels active runs", async () => {
    const terminal = runDetail({
      id: "run_done",
      projectId: "prj_1",
      agentId: "agt_1",
      state: RunState.Succeeded,
    });
    const blocked = await cancelRunCommand(
      {
        coordinator: {} as RunCoordinatorPort,
        reads: stubReads({ detail: () => terminal }),
        clock: clock(),
        uow: new InMemoryUnitOfWork(),
      },
      { runId: "run_done" },
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toContain("terminal");
    }

    const uow = new InMemoryUnitOfWork();
    const active = runDetail({
      id: "run_active",
      projectId: "prj_1",
      agentId: "agt_1",
      state: RunState.Running,
    });
    const canceled = runDetail({
      id: "run_active",
      projectId: "prj_1",
      agentId: "agt_1",
      state: RunState.Canceled,
    });
    let reads = 0;
    const cancelRun = mock(async () => {});

    const result = await cancelRunCommand(
      {
        coordinator: { cancelRun } as unknown as RunCoordinatorPort,
        reads: stubReads({
          detail: () => {
            reads += 1;
            return reads === 1 ? active : canceled;
          },
        }),
        clock: clock(),
        uow,
      },
      { runId: "run_active" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ runId: "run_active", state: RunState.Canceled });
    }
    expect(cancelRun).toHaveBeenCalledWith("run_active");
    expect(uow.events()[0]?.type).toBe("execution.run.canceled");
  });

  test("approveRunCommand and rejectRunCommand require AwaitingApproval", async () => {
    const running = runDetail({
      id: "run_running",
      projectId: "prj_1",
      agentId: "agt_1",
      state: RunState.Running,
    });
    const approveBlocked = await approveRunCommand(
      {
        coordinator: {} as RunCoordinatorPort,
        reads: stubReads({ detail: () => running }),
        clock: clock(),
        uow: new InMemoryUnitOfWork(),
      },
      { runId: "run_running" },
    );
    expect(approveBlocked.ok).toBe(false);

    const awaiting = runDetail({
      id: "run_approval",
      projectId: "prj_1",
      agentId: "agt_1",
      state: RunState.AwaitingApproval,
    });
    const failed = runDetail({
      id: "run_approval",
      projectId: "prj_1",
      agentId: "agt_1",
      state: RunState.Failed,
    });
    let reads = 0;
    const uow = new InMemoryUnitOfWork();
    const rejectRun = mock(async () => {});

    const result = await rejectRunCommand(
      {
        coordinator: { rejectRun } as unknown as RunCoordinatorPort,
        reads: stubReads({
          detail: () => {
            reads += 1;
            return reads === 1 ? awaiting : failed;
          },
        }),
        clock: clock(),
        uow,
      },
      { runId: "run_approval", reason: "needs work" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe(RunState.Failed);
    }
    expect(rejectRun).toHaveBeenCalledWith("run_approval", "needs work");
    expect(uow.events()[0]?.type).toBe("execution.run.rejected");
    expect(uow.events()[0]?.data).toEqual({
      state: RunState.Failed,
      reason: "needs work",
    });
  });

  test("getRunQuery returns detail and getRunDiffQuery maps read errors", async () => {
    const detail = runDetail({
      id: "run_1",
      projectId: "prj_1",
      agentId: "agt_1",
      state: RunState.Succeeded,
    });
    const reads = stubReads({
      detail: (runId) => (runId === "run_1" ? detail : null),
      diff: async () => {
        throw new Error("workspace missing");
      },
    });

    const found = await getRunQuery({ reads }, { runId: "run_1" });
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value.run.id).toBe("run_1");
    }

    const missing = await getRunQuery({ reads }, { runId: "run_missing" });
    expect(missing.ok).toBe(false);

    const diff = await getRunDiffQuery({ reads }, { runId: "run_1" });
    expect(diff.ok).toBe(false);
    if (!diff.ok) {
      expect(diff.error).toBe("workspace missing");
    }
  });
});
