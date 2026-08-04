/**
 * Persistence ports for the delivery approval ledger.
 * Implementations live in infrastructure/approval-repositories.ts.
 */
import type {
  Approval,
  ApprovalState,
  ChecksState,
  ControlIntent,
  CreateApproval,
  ReviewVerdict,
  SubmitControlIntent,
} from "@shared/approvals";
import type { PaginatedList } from "@shared/pagination";

export type UpdateApprovalInput = {
  runId?: string | null;
  workItemId?: string | null;
  autonomy?: Approval["autonomy"];
  state?: Approval["state"];
  reviewVerdict?: ReviewVerdict | null;
  checksState?: ChecksState | null;
  evidence?: Record<string, unknown>;
  decidedBy?: string | null;
  decidedVia?: string | null;
  note?: string | null;
  attempts?: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
};

export interface ApprovalRepository {
  create(input: CreateApproval): Approval;
  findById(id: string): Approval | null;
  findByRun(runId: string): Approval | null;
  findBySubject(subjectType: string, subjectId: string): Approval | null;
  list(input: {
    projectId?: string;
    state?: ApprovalState;
    subjectType?: string;
    limit: number;
    offset: number;
  }): PaginatedList<Approval>;
  update(id: string, input: UpdateApprovalInput): Approval | null;
}

export interface ControlIntentRepository {
  create(
    input: SubmitControlIntent & {
      state: ControlIntent["state"];
      error?: string | null;
    },
  ): ControlIntent;
  findById(id: string): ControlIntent | null;
  findBySurfaceRef(surface: string, surfaceRef: string): ControlIntent | null;
  listByTarget(targetType: string, targetId: string): ControlIntent[];
}
