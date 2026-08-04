import { domainEvent, err, ok, type Clock, type Result, type UnitOfWork } from "@/kernel";

import { canCancel } from "../domain/run-transitions";
import type { RunCoordinatorPort } from "../ports/run-coordinator";
import type { RunReadModel } from "../ports/run-read-model";

export type CancelRunDeps = {
  coordinator: RunCoordinatorPort;
  reads: RunReadModel;
  clock: Clock;
  uow: UnitOfWork;
};

export async function cancelRunCommand(
  deps: CancelRunDeps,
  input: { runId: string },
): Promise<Result<{ runId: string; state: string }>> {
  const before = deps.reads.detail(input.runId);
  if (!before) {
    return err(`run not found: ${input.runId}`);
  }
  if (!canCancel(before.run.state)) {
    return err(`run ${input.runId} is already terminal (${before.run.state})`);
  }

  await deps.coordinator.cancelRun(input.runId);
  const after = deps.reads.detail(input.runId);
  const state = after?.run.state ?? before.run.state;

  deps.uow.addEvent(
    domainEvent(
      {
        type: "execution.run.canceled",
        entityKind: "run",
        entityId: input.runId,
        projectId: before.run.projectId,
        topics: ["runs", "queue", "dashboard"],
        data: { state },
      },
      deps.clock.nowIso(),
    ),
  );

  return ok({ runId: input.runId, state });
}
