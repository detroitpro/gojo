import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { ApprovalDetail, ApprovalStore } from "../ports/approval-store";

export type GetApprovalInput = { id: string };
export type GetApprovalDeps = { store: ApprovalStore };

export async function getApprovalQuery(
  deps: GetApprovalDeps,
  input: GetApprovalInput,
): Promise<Result<ApprovalDetail, UseCaseFailure>> {
  const detail = deps.store.findApprovalDetail(input.id);
  if (!detail) return useCaseFailure("not_found", "Approval not found", 404);
  return ok(detail);
}
