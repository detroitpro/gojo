import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";
import type { Approval, ControlIntent } from "@shared/approvals";

import type { ApprovalStore } from "../ports/approval-store";

export type SubmitApprovalIntentInput = {
  approvalId: string;
  action: "approve" | "reject" | "hold";
  actor: string;
  surface: "ui" | "cli" | "api" | "forge-comment" | "chat" | "system";
  surfaceRef?: string | null;
  note?: string | null;
  /** When provided, revoke this token after a successful approve. */
  revokeAfterApprove?: { userId: string; tokenId: string } | null;
};

export type SubmitApprovalIntentDeps = { store: ApprovalStore };

export async function submitApprovalIntentCommand(
  deps: SubmitApprovalIntentDeps,
  input: SubmitApprovalIntentInput,
): Promise<Result<{ intent: ControlIntent; approval: Approval | null }, UseCaseFailure>> {
  const approval = deps.store.findApproval(input.approvalId);
  if (!approval) return useCaseFailure("not_found", "Approval not found", 404);

  const intent = await deps.store.submitIntent({
    projectId: approval.projectId,
    kind: input.action,
    targetType: "approval",
    targetId: approval.id,
    actor: input.actor,
    surface: input.surface,
    surfaceRef: input.surfaceRef ?? null,
    note: input.note ?? null,
  });

  if (intent.state === "rejected") {
    return useCaseFailure(
      "conflict",
      intent.error ?? "Approval intent rejected",
      409,
    );
  }

  if (input.action === "approve" && input.revokeAfterApprove) {
    deps.store.revokeApprovalToken(
      input.revokeAfterApprove.userId,
      input.revokeAfterApprove.tokenId,
    );
  }

  return ok({ intent, approval: deps.store.findApproval(approval.id) });
}
