import type { AppContext } from "@/platform/app-context";

import type { RunCoordinatorPort } from "../ports/run-coordinator";

/**
 * Adapts the live `RunCoordinator` on an `AppContext` to the execution port.
 * This is the seam that lets the application/use-case layer stay decoupled
 * from `src/runs/coordinator.ts` while that file is migrated in place.
 *
 * @removal(when: src/runs moves under src/contexts/execution/infrastructure):
 * replace this passthrough with a direct RunCoordinator construction from the
 * module builder — removal-backlog E-EX1
 */
export class AppContextCoordinatorAdapter implements RunCoordinatorPort {
  constructor(private readonly ctx: AppContext) {}

  async enqueueRun(input: {
    projectId: string;
    agentId: string;
    trigger: "schedule" | "manual" | "api" | "web" | "heal" | "work";
    scheduleId?: string;
    idempotencyKey?: string;
    notBeforeAt?: string;
    expiresAt?: string;
    subjectWorkItemId?: string;
    resumeBranch?: string;
    subjectFeedback?: { round: number; checksSummary?: string; reviewSummary?: string; references?: string[] };
  }): Promise<{ id: string; state: string }> {
    const run = await this.ctx.coordinator.enqueueRun(input);
    return { id: run.id, state: run.state };
  }

  async cancelRun(runId: string): Promise<void> {
    await this.ctx.coordinator.cancelRun(runId);
  }

  async approveRun(runId: string): Promise<void> {
    await this.ctx.coordinator.approveRun(runId);
  }

  async rejectRun(runId: string, reason?: string | null): Promise<void> {
    await this.ctx.coordinator.rejectRun(runId, reason ?? undefined);
  }

  updateProgress(
    runId: string,
    progress: {
      title: string;
      summary: string;
      blockedReason: string | null;
      references: string[];
    },
  ): { id: string; state: string; projectId: string; agentId: string } {
    const run = this.ctx.coordinator.updateProgress(runId, progress);
    return {
      id: run.id,
      state: run.state,
      projectId: run.projectId,
      agentId: run.agentId,
    };
  }
}
