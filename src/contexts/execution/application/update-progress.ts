import { domainEvent, err, ok, type Clock, type Result, type UnitOfWork } from "@/kernel";

import type { RunCoordinatorPort } from "../ports/run-coordinator";
import type { RunReadModel } from "../ports/run-read-model";

export type UpdateProgressDeps = {
  coordinator: RunCoordinatorPort;
  reads: RunReadModel;
  clock: Clock;
  uow: UnitOfWork;
};

export async function updateRunProgressCommand(
  deps: UpdateProgressDeps,
  input: {
    runId: string;
    title: string;
    summary: string;
    blockedReason: string | null;
    references: string[];
  },
): Promise<Result<{ runId: string; state: string }>> {
  try {
    const run = deps.coordinator.updateProgress(input.runId, {
      title: input.title,
      summary: input.summary,
      blockedReason: input.blockedReason,
      references: input.references,
    });
    deps.uow.addEvent(
      domainEvent(
        {
          type: "execution.run.progress",
          entityKind: "run",
          entityId: run.id,
          projectId: run.projectId,
          topics: ["runs"],
          data: {
            title: input.title,
            blocked: input.blockedReason !== null,
          },
        },
        deps.clock.nowIso(),
      ),
    );
    return ok({ runId: run.id, state: run.state });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(message);
  }
}

export function detailQuery(
  deps: { reads: RunReadModel },
  input: { runId: string },
): Result<{ run: unknown; attempts: unknown; impactItems: unknown; integration: unknown; approval: unknown }> {
  const detail = deps.reads.detail(input.runId);
  if (!detail) {
    return err(`run not found: ${input.runId}`);
  }
  return ok(detail);
}
