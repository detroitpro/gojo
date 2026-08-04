import { domainEvent, err, ok, type Clock, type Result, type UnitOfWork } from "@/kernel";

import type { RunCoordinatorPort } from "../ports/run-coordinator";
import type { RunReadModel } from "../ports/run-read-model";

export type RetryRunDeps = {
  coordinator: RunCoordinatorPort;
  reads: RunReadModel;
  clock: Clock;
  uow: UnitOfWork;
};

export async function retryRunCommand(
  deps: RetryRunDeps,
  input: { runId: string },
): Promise<Result<{ run: { id: string; state: string } }>> {
  const existing = deps.reads.detail(input.runId);
  if (!existing) {
    return err(`run not found: ${input.runId}`);
  }

  const retried = await deps.coordinator.enqueueRun({
    projectId: existing.run.projectId,
    agentId: existing.run.agentId,
    trigger: "manual",
  });
  deps.uow.addEvent(
    domainEvent(
      {
        type: "execution.run.retried",
        entityKind: "run",
        entityId: retried.id,
        projectId: existing.run.projectId,
        topics: ["runs", "queue", "dashboard"],
        data: { retryOf: input.runId },
      },
      deps.clock.nowIso(),
    ),
  );
  return ok({ run: { id: retried.id, state: retried.state } });
}
