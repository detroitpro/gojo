import type { AppContext } from "@/platform/app-context";
import { UserService } from "@/contexts/access/contract";
import { agentConfiguredAutonomy } from "@/contexts/delivery/domain/fix-rounds";
import {
  INTEGRATION_SORT_ALLOWED,
  listIntegrationsPage,
} from "@/contexts/delivery/infrastructure/integration-paged-lists";
import type {
  Approval,
  ApprovalAutonomy,
  ApprovalState,
  ControlIntent,
  SubmitControlIntent,
} from "@shared/approvals";

import type {
  ApprovalDetail,
  ApprovalPage,
  ApprovalStore,
  EnrichedApprovalRow,
  IntegrationsPage,
} from "../ports/approval-store";

export class AppApprovalStore implements ApprovalStore {
  constructor(private readonly ctx: AppContext) {}

  listApprovals(input: {
    limit: number;
    offset: number;
    projectId?: string | null;
    subjectType?: string | null;
    state?: ApprovalState | null;
  }): ApprovalPage {
    const raw = this.ctx.approvals.list({
      limit: input.limit,
      offset: input.offset,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.subjectType ? { subjectType: input.subjectType } : {}),
      ...(input.state ? { state: input.state } : {}),
    });
    const items: EnrichedApprovalRow[] = raw.items.map((approval) =>
      this.enrichApproval(approval),
    );
    return {
      items,
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  }

  findApprovalDetail(id: string): ApprovalDetail | null {
    const approval = this.ctx.approvals.findById(id);
    if (!approval) return null;
    const workItem = approval.workItemId
      ? this.ctx.work.items.findById(approval.workItemId)
      : null;
    return {
      ...approval,
      workTitle: workItem?.title ?? null,
      workUrl: workItem?.webUrl ?? null,
    };
  }

  findApproval(id: string): Approval | null {
    return this.ctx.approvals.findById(id);
  }

  async submitIntent(input: SubmitControlIntent): Promise<ControlIntent> {
    return this.ctx.approvals.submitIntent(input);
  }

  async setAutonomy(
    approvalId: string,
    autonomy: ApprovalAutonomy,
  ): Promise<Approval> {
    return this.ctx.approvals.setAutonomy(approvalId, autonomy);
  }

  revokeApprovalToken(userId: string, tokenId: string): void {
    new UserService(this.ctx.db).revokeApiToken(userId, tokenId);
  }

  listIntegrations(input: {
    limit: number;
    offset: number;
    sort: string;
    order: "asc" | "desc";
    status: "open" | "merged" | "committed";
    projectId?: string | null;
    from?: string | null;
    to?: string | null;
  }): IntegrationsPage {
    const raw = listIntegrationsPage(this.ctx.db, {
      limit: input.limit,
      offset: input.offset,
      sort: input.sort,
      order: input.order,
      status: input.status,
      projectId: input.projectId ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
    });
    return {
      items: raw.items as unknown as IntegrationsPage["items"],
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  }

  async approveRun(runId: string): Promise<void> {
    await this.ctx.coordinator.approveRun(runId);
  }

  async rejectRun(runId: string, reason?: string | null): Promise<void> {
    await this.ctx.coordinator.rejectRun(runId, reason ?? undefined);
  }

  findRun(runId: string): { id: string; state: string } | null {
    const run = this.ctx.repos.runs.findById(runId);
    return run ? { id: run.id, state: run.state } : null;
  }

  private enrichApproval(approval: Approval): EnrichedApprovalRow {
    const workItem = approval.workItemId
      ? this.ctx.work.items.findById(approval.workItemId)
      : null;
    const run = approval.runId
      ? this.ctx.repos.runs.findById(approval.runId)
      : null;
    const evidenceAgentId =
      typeof approval.evidence["implementingAgentId"] === "string"
        ? (approval.evidence["implementingAgentId"] as string)
        : null;
    const agent = run
      ? this.ctx.repos.agents.findById(run.agentId)
      : evidenceAgentId
        ? this.ctx.repos.agents.findById(evidenceAgentId)
        : null;
    const project = this.ctx.repos.projects.findById(approval.projectId);
    const agentAutonomy = agent
      ? agentConfiguredAutonomy(agent.integrationJson)
      : null;
    return {
      ...approval,
      workTitle: workItem?.title ?? null,
      workUrl: workItem?.webUrl ?? null,
      agentName: agent?.name ?? null,
      projectName: project?.name ?? null,
      agentAutonomy,
      autonomyMismatch: agentAutonomy !== null && agentAutonomy !== approval.autonomy,
    };
  }
}

export const DELIVERY_INTEGRATION_SORT_ALLOWED = INTEGRATION_SORT_ALLOWED;
