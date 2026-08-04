import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";
import { ApprovalAutonomySchema, type Approval } from "@shared/approvals";

import type { ApprovalStore } from "../ports/approval-store";

export type SetApprovalAutonomyInput = { id: string; autonomy: unknown };
export type SetApprovalAutonomyDeps = { store: ApprovalStore };

export async function setApprovalAutonomyCommand(
  deps: SetApprovalAutonomyDeps,
  input: SetApprovalAutonomyInput,
): Promise<Result<{ approval: Approval }, UseCaseFailure>> {
  const parsed = ApprovalAutonomySchema.safeParse(input.autonomy);
  if (!parsed.success) {
    return useCaseFailure(
      "validation_error",
      "autonomy must be manual, reviewer, or auto",
      400,
    );
  }
  const approval = deps.store.findApproval(input.id);
  if (!approval) return useCaseFailure("not_found", "Approval not found", 404);
  const updated = await deps.store.setAutonomy(approval.id, parsed.data);
  return ok({ approval: updated });
}
