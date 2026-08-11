import type { AppContext } from "@/platform/app-context";
import { failureMessage } from "@/platform/errors";
import type {
  Approval,
  ApprovalAutonomy,
  ApprovalState,
  ControlIntent,
  SubmitControlIntent,
} from "@shared/approvals";

import { getApprovalQuery } from "./application/get-approval";
import { listApprovalsQuery } from "./application/list-approvals";
import { listIntegrationsQuery } from "./application/list-integrations";
import { runApproveCommand, runRejectCommand } from "./application/run-approve";
import { setApprovalAutonomyCommand } from "./application/set-approval-autonomy";
import { submitApprovalIntentCommand } from "./application/submit-approval-intent";
import { submitControlIntentCommand } from "./application/submit-control-intent";
import { AppApprovalStore } from "./infrastructure/app-approval-store";
import type {
  ApprovalDetail,
  ApprovalPage,
  ApprovalStore,
  IntegrationsPage,
} from "./ports/approval-store";

export * from "./contract";

export type DeliveryModule = {
  listApprovals(input: {
    limit: number;
    offset: number;
    projectId?: string | null;
    subjectType?: string | null;
    state?: ApprovalState | null;
  }): Promise<ApprovalPage>;
  getApproval(id: string): Promise<ApprovalDetail | null>;
  submitApprovalIntent(input: {
    approvalId: string;
    action: "approve" | "reject" | "hold";
    actor: string;
    surface: "ui" | "cli" | "api" | "forge-comment" | "chat" | "system";
    surfaceRef?: string | null;
    note?: string | null;
    revokeAfterApprove?: { userId: string; tokenId: string } | null;
  }): Promise<
    | { ok: true; intent: ControlIntent; approval: Approval | null }
    | { ok: false; code: "not_found" | "conflict"; message: string }
  >;
  setApprovalAutonomy(
    id: string,
    autonomy: ApprovalAutonomy,
  ): Promise<Approval>;
  submitControlIntent(
    input: SubmitControlIntent,
  ): Promise<{ intent: ControlIntent; successStatus: 201 | 409 }>;
  listIntegrations(input: {
    status: string | null;
    limit?: string | number | null;
    offset?: string | number | null;
    sort?: string | null;
    order?: "asc" | "desc" | null;
    projectId?: string | null;
    from?: string | null;
    to?: string | null;
  }): Promise<IntegrationsPage>;
  approveRun(runId: string): Promise<{ run: { id: string; state: string } | null }>;
  rejectRun(
    runId: string,
    reason?: string | null,
  ): Promise<{ run: { id: string; state: string } | null }>;
};

export function buildDeliveryModule(deps: {
  ctx: AppContext;
  store?: ApprovalStore;
}): DeliveryModule {
  const store = deps.store ?? new AppApprovalStore(deps.ctx);
  return {
    async listApprovals(input) {
      const result = await listApprovalsQuery({ store }, input);
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async getApproval(id) {
      const result = await getApprovalQuery({ store }, { id });
      if (!result.ok) return null;
      return result.value;
    },
    async submitApprovalIntent(input) {
      const result = await submitApprovalIntentCommand({ store }, input);
      if (result.ok) {
        return { ok: true, ...result.value };
      }
      return {
        ok: false,
        code: result.error.code === "not_found" ? "not_found" : "conflict",
        message: result.error.message,
      };
    },
    async setApprovalAutonomy(id, autonomy) {
      const result = await setApprovalAutonomyCommand({ store }, { id, autonomy });
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value.approval;
    },
    async submitControlIntent(input) {
      const result = await submitControlIntentCommand({ store }, input);
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async listIntegrations(input) {
      const result = await listIntegrationsQuery({ store }, input);
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async approveRun(runId) {
      const result = await runApproveCommand({ store }, { id: runId });
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async rejectRun(runId, reason) {
      const result = await runRejectCommand({ store }, {
        id: runId,
        reason: reason ?? null,
      });
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
  };
}
