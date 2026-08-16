/**
 * Public surface of the delivery context.
 * Cross-context imports must go through this module.
 */
export type {
  ApprovalPage,
  ApprovalDetail,
  ApprovalStore,
  EnrichedApprovalRow,
  IntegrationListItem,
  IntegrationsPage,
} from "./ports/approval-store";

export type { ListApprovalsDeps, ListApprovalsInput } from "./application/list-approvals";
export { listApprovalsQuery } from "./application/list-approvals";

export type { GetApprovalDeps, GetApprovalInput } from "./application/get-approval";
export { getApprovalQuery } from "./application/get-approval";

export type {
  SubmitApprovalIntentDeps,
  SubmitApprovalIntentInput,
} from "./application/submit-approval-intent";
export { submitApprovalIntentCommand } from "./application/submit-approval-intent";

export type {
  SetApprovalAutonomyDeps,
  SetApprovalAutonomyInput,
} from "./application/set-approval-autonomy";
export { setApprovalAutonomyCommand } from "./application/set-approval-autonomy";

export type {
  SubmitControlIntentDeps,
  SubmitControlIntentInput,
} from "./application/submit-control-intent";
export { submitControlIntentCommand } from "./application/submit-control-intent";

export type {
  ListIntegrationsDeps,
  ListIntegrationsInput,
} from "./application/list-integrations";
export { listIntegrationsQuery } from "./application/list-integrations";

export type { RunApproveDeps, RunApproveInput, RunRejectInput } from "./application/run-approve";
export { runApproveCommand, runRejectCommand } from "./application/run-approve";

export {
  extractPrNumber,
  initialNextCheckAt,
  IntegrationStatusReconciler,
} from "./application/status-reconciler";
export { ApprovalService } from "./application/approval-service";
export { MergeService } from "./application/merge-service";
export { CommentIntentService } from "./application/comment-intents";
export {
  agentConfiguredAutonomy,
  fixRoundEscalateReason,
  formatChecksSummary,
  isRetryableFixRoundStall,
  resolveApprovalForIntegration,
  resolveFixRoundSubject,
} from "./domain/fix-rounds";

export {
  createApprovalRepository,
  createControlIntentRepository,
} from "./infrastructure/approval-repositories";
export type {
  ApprovalRepository,
  ControlIntentRepository,
  UpdateApprovalInput,
} from "./ports/approval-repositories";

export { createRunIntegrationRepository } from "./infrastructure/integration-repositories";
export { listIntegrationsPage } from "./infrastructure/integration-paged-lists";
export type {
  IntegrationListRow,
  ListIntegrationsPageInput,
} from "./infrastructure/integration-paged-lists";
