/**
 * Public surface of the execution context.
 * Other contexts may import only from this module.
 */
export {
  RunState,
  canCancel,
  canDecideApproval,
  canRetry,
  canTransition,
  guardTransition,
  isTerminal,
  type RunStateName,
  type TransitionRejection,
  type TransitionResult,
} from "./domain/run-transitions";

export {
  RUN_BRANCH_NAMESPACE,
  buildRunBranchName,
} from "./domain/run-branch";

export {
  formatMergeScopePrompt,
  mergePolicyFromManifest,
  resolveMergeScope,
  type MergeScope,
} from "./domain/merge-scope";

export type { RunCoordinatorPort } from "./ports/run-coordinator";
export type {
  RunArtifactsRead,
  RunDetail,
  RunDiffRead,
  RunListItem,
  RunListPage,
  RunListQuery,
  RunReadModel,
} from "./ports/run-read-model";

export type { CancelRunDeps } from "./application/cancel-run";
export { cancelRunCommand } from "./application/cancel-run";
export type { ApproveRunDeps } from "./application/approve-run";
export { approveRunCommand, rejectRunCommand } from "./application/approve-run";
export type { RetryRunDeps } from "./application/retry-run";
export { retryRunCommand } from "./application/retry-run";
export type { UpdateProgressDeps } from "./application/update-progress";
export { updateRunProgressCommand } from "./application/update-progress";
export type { ListRunsDeps } from "./application/list-runs";
export { listRunsQuery } from "./application/list-runs";
export type { GetRunDeps } from "./application/get-run";
export {
  getRunArtifactsQuery,
  getRunDiffQuery,
  getRunQuery,
} from "./application/get-run";

export {
  RunCoordinator,
  type CreateRunInput,
} from "./infrastructure/coordinator";
export { RunDispatcher } from "./application/dispatcher";
export {
  selectAdmissions,
  type AdmissionCandidate,
  type AdmissionDecision,
  type AdmissionSnapshot,
} from "./application/admission";
export {
  RunEventBus,
  RunEventHistory,
  type RunEvent,
} from "./infrastructure/events";
export {
  getRunArtifacts,
  getRunDiff,
  resolveRunHandoffSummary,
  type RunArtifactsResult,
  type RunDiffResult,
  type RunHandoffSummary,
} from "./application/inspect";

export { createRunRepositories } from "./infrastructure/run-repositories";
export { listRunsPage } from "./infrastructure/run-paged-lists";
export type { ListRunsPageInput, RunListRow } from "./infrastructure/run-paged-lists";
