import type {
  Approval,
  ApprovalAutonomy,
  ApprovalState,
  ControlIntent,
  SubmitControlIntent,
} from "@shared/approvals";

export type EnrichedApprovalRow = Approval & {
  workTitle: string | null;
  workUrl: string | null;
  agentName: string | null;
  projectName: string | null;
  agentAutonomy: ApprovalAutonomy | null;
  autonomyMismatch: boolean;
};

export type ApprovalPage = {
  items: EnrichedApprovalRow[];
  total: number;
  limit: number;
  offset: number;
};

export type ApprovalDetail = Approval & {
  workTitle: string | null;
  workUrl: string | null;
};

export type IntegrationListItem = {
  runId: string;
  projectId: string;
  projectName: string | null;
  status: string;
  prNumber: number | null;
  prUrl: string | null;
  [key: string]: unknown;
};

export type IntegrationsPage = {
  items: IntegrationListItem[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * Read/write surface for delivery use cases. Wraps the existing
 * `ApprovalService`, `MergeService`, and integration query modules so the
 * application layer can be unit-tested with an in-memory port.
 */
export interface ApprovalStore {
  listApprovals(input: {
    limit: number;
    offset: number;
    projectId?: string | null;
    subjectType?: string | null;
    state?: ApprovalState | null;
  }): ApprovalPage;
  findApprovalDetail(id: string): ApprovalDetail | null;
  submitIntent(input: SubmitControlIntent): Promise<ControlIntent>;
  setAutonomy(
    approvalId: string,
    autonomy: ApprovalAutonomy,
  ): Promise<Approval>;
  findApproval(id: string): Approval | null;
  revokeApprovalToken(userId: string, tokenId: string): void;
  listIntegrations(input: {
    limit: number;
    offset: number;
    sort: string;
    order: "asc" | "desc";
    status: "open" | "merged" | "committed";
    projectId?: string | null;
    from?: string | null;
    to?: string | null;
  }): IntegrationsPage;
  approveRun(runId: string): Promise<void>;
  rejectRun(runId: string, reason?: string | null): Promise<void>;
  findRun(runId: string): { id: string; state: string } | null;
}
