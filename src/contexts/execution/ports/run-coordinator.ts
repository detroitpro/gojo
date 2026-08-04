import type { RunTrigger } from "@shared/scheduling";

/**
 * Minimal port that execution use cases require from the run coordinator.
 * The concrete implementation lives in `infrastructure/` and wraps
 * `src/runs/coordinator.ts` until that file is fully migrated.
 */
export interface RunCoordinatorPort {
  enqueueRun(input: {
    projectId: string;
    agentId: string;
    trigger: RunTrigger;
    scheduleId?: string;
    idempotencyKey?: string;
    notBeforeAt?: string;
    expiresAt?: string;
    subjectWorkItemId?: string;
    resumeBranch?: string;
    subjectFeedback?: { round: number; checksSummary?: string; reviewSummary?: string; references?: string[] };
  }): Promise<{ id: string; state: string }>;
  cancelRun(runId: string): Promise<void>;
  approveRun(runId: string): Promise<void>;
  rejectRun(runId: string, reason?: string | null | undefined): Promise<void>;
  updateProgress(
    runId: string,
    progress: {
      title: string;
      summary: string;
      blockedReason: string | null;
      references: string[];
    },
  ): { id: string; state: string; projectId: string; agentId: string };
}
