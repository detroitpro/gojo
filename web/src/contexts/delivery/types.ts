export type {
  ApprovalState,
  IntegrationListItem,
  IntegrationListStatus,
} from "@gojo/contracts/types";

import type { Approval as ContractApproval } from "@gojo/contracts/types";

/** Approval list/detail row with UI enrichments from the API. */
export interface Approval extends ContractApproval {
  workTitle?: string | null;
  workUrl?: string | null;
  agentName?: string | null;
  projectName?: string | null;
  agentAutonomy?: "manual" | "reviewer" | "auto" | null;
  autonomyMismatch?: boolean;
}
