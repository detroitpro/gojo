import type { Approval, ApprovalState } from "./types";
import type { IntegrationListItem, IntegrationListStatus } from "@gojo/contracts/types";
import { request } from "@/infrastructure/http";
import { buildListQuery, type ListQuery, type PaginatedResult } from "@/kernel/pagination";

export async function listIntegrations(
  query: ListQuery & { status?: IntegrationListStatus },
): Promise<PaginatedResult<IntegrationListItem>> {
  const { data } = await request<{
    integrations: IntegrationListItem[];
    total: number;
    limit: number;
    offset: number;
  }>(`/integrations${buildListQuery(query)}`);
  return {
    items: data.integrations,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function listApprovals(
  query: ListQuery & {
    state?: ApprovalState;
    projectId?: string;
    subjectType?: string;
  } = {},
): Promise<PaginatedResult<Approval>> {
  const { data } = await request<{
    approvals: Approval[];
    total: number;
    limit: number;
    offset: number;
  }>(`/approvals${buildListQuery(query)}`);
  return {
    items: data.approvals,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function updateApproval(
  id: string,
  action: "approve" | "reject" | "hold",
  note?: string,
): Promise<Approval> {
  const { data } = await request<{ approval: Approval }>(
    `/approvals/${encodeURIComponent(id)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify({ note }),
    },
  );
  return data.approval;
}
