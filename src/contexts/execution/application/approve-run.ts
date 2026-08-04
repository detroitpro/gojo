import { domainEvent, err, ok, type Clock, type Result, type UnitOfWork } from "@/kernel";

import { canDecideApproval } from "../domain/run-transitions";
import type { RunCoordinatorPort } from "../ports/run-coordinator";
import type { RunReadModel } from "../ports/run-read-model";

export type ApproveRunDeps = {
  coordinator: RunCoordinatorPort;
  reads: RunReadModel;
  clock: Clock;
  uow: UnitOfWork;
};

export async function approveRunCommand(
  deps: ApproveRunDeps,
  input: { runId: string },
): Promise<Result<{ runId: string; state: string }>> {
  const before = deps.reads.detail(input.runId);
  if (!before) {
    return err(`run not found: ${input.runId}`);
  }
  if (!canDecideApproval(before.run.state)) {
    return err(`run ${input.runId} is not awaiting approval (state=${before.run.state})`);
  }

  await deps.coordinator.approveRun(input.runId);
  const after = deps.reads.detail(input.runId);
  const state = after?.run.state ?? before.run.state;
  deps.uow.addEvent(
    domainEvent(
      {
        type: "execution.run.approved",
        entityKind: "run",
        entityId: input.runId,
        projectId: before.run.projectId,
        topics: ["runs", "dashboard"],
        data: { state },
      },
      deps.clock.nowIso(),
    ),
  );
  return ok({ runId: input.runId, state });
}

export async function rejectRunCommand(
  deps: ApproveRunDeps,
  input: { runId: string; reason?: string | null },
): Promise<Result<{ runId: string; state: string }>> {
  const before = deps.reads.detail(input.runId);
  if (!before) {
    return err(`run not found: ${input.runId}`);
  }
  if (!canDecideApproval(before.run.state)) {
    return err(`run ${input.runId} is not awaiting approval (state=${before.run.state})`);
  }
  await deps.coordinator.rejectRun(input.runId, input.reason ?? null);
  const after = deps.reads.detail(input.runId);
  const state = after?.run.state ?? before.run.state;
  deps.uow.addEvent(
    domainEvent(
      {
        type: "execution.run.rejected",
        entityKind: "run",
        entityId: input.runId,
        projectId: before.run.projectId,
        topics: ["runs", "dashboard"],
        data: { state, reason: input.reason ?? null },
      },
      deps.clock.nowIso(),
    ),
  );
  return ok({ runId: input.runId, state });
}
