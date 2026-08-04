import { ok, type Result } from "@/kernel";
import type { UseCaseFailure } from "@/platform/errors";
import type { ApprovalState } from "@shared/approvals";

import type { ApprovalPage, ApprovalStore } from "../ports/approval-store";

export type ListApprovalsInput = {
  limit: number;
  offset: number;
  projectId?: string | null;
  subjectType?: string | null;
  state?: ApprovalState | null;
};

export type ListApprovalsDeps = { store: ApprovalStore };

export async function listApprovalsQuery(
  deps: ListApprovalsDeps,
  input: ListApprovalsInput,
): Promise<Result<ApprovalPage, UseCaseFailure>> {
  return ok(deps.store.listApprovals(input));
}
