import type { ProjectSource, WorkItem, WorkRecheckResult, WorkStatus } from "./types";
import { request } from "@/infrastructure/http";
import { buildListQuery, type ListQuery, type PaginatedResult } from "@/kernel/pagination";

export async function getWorkDiff(workItemId: string): Promise<string> {
  const { data } = await request<{ diff: string }>(
    `/work/${encodeURIComponent(workItemId)}/diff`,
  );
  return data.diff;
}

export async function listProjectWork(
  projectId: string,
  query: ListQuery = {},
): Promise<PaginatedResult<WorkItem>> {
  const { data } = await request<{
    items: WorkItem[];
    total: number;
    limit: number;
    offset: number;
  }>(`/projects/${projectId}/work${buildListQuery(query)}`);
  return data;
}

export async function getProjectWorkStatus(
  projectId: string,
  compare?: string,
): Promise<WorkStatus> {
  const suffix = compare ? `?compare=${encodeURIComponent(compare)}` : "";
  const { data } = await request<WorkStatus>(`/projects/${projectId}/work/status${suffix}`);
  return data;
}

export async function listProjectSources(projectId: string): Promise<ProjectSource[]> {
  const { data } = await request<{ sources: ProjectSource[] }>(
    `/projects/${projectId}/sources`,
  );
  return data.sources;
}

export async function refreshProjectSource(
  projectId: string,
  sourceId: string,
): Promise<void> {
  await request(`/projects/${projectId}/sources/${sourceId}/refresh`, {
    method: "POST",
  });
}

export async function recheckWorkItem(workItemId: string): Promise<WorkRecheckResult> {
  const { data } = await request<{ result: WorkRecheckResult }>(`/work/${workItemId}/recheck`, {
    method: "POST",
  });
  return data.result;
}

export async function resolveWorkItem(
  workItemId: string,
  input: { note?: string | null } = {},
): Promise<WorkItem> {
  const { data } = await request<{ work: WorkItem }>(`/work/${workItemId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ note: input.note ?? null }),
  });
  return data.work;
}
