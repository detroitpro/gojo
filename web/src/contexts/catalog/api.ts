import type {
  AdapterInfo,
  AdapterTestResult,
  Agent,
  ImpactItemListRow,
  Project,
  ProjectSyncResponse,
  Schedule,
} from "./types";
import type { Run } from "@/contexts/execution/contract";
import { ApiError } from "@/infrastructure/api-error";
import { request } from "@/infrastructure/http";
import { buildListQuery, type ListQuery, type PaginatedResult } from "@/kernel/pagination";

export async function listProjects(query: ListQuery = {}): Promise<PaginatedResult<Project>> {
  const { data } = await request<{
    projects: Project[];
    total: number;
    limit: number;
    offset: number;
  }>(`/projects${buildListQuery(query)}`);
  return {
    items: data.projects,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function createProject(input: {
  name: string;
  repoPath: string;
  defaultBranch?: string;
  remoteUrl?: string;
}): Promise<Project> {
  const { data } = await request<{ project: Project }>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.project;
}

export async function getProject(id: string): Promise<Project> {
  const { data } = await request<{ project: Project }>(`/projects/${id}`);
  return data.project;
}

export async function syncProject(id: string): Promise<ProjectSyncResponse> {
  const { data } = await request<ProjectSyncResponse & { project: Project | null }>(
    `/projects/${id}/sync`,
    {
      method: "POST",
    },
  );
  if (!data.project) {
    throw new ApiError("not_found", "Project not found after sync", 404);
  }
  return { project: data.project, sync: data.sync };
}

export async function deleteProject(id: string): Promise<boolean> {
  const { data } = await request<{ removed: boolean }>(`/projects/${id}`, { method: "DELETE" });
  return data.removed;
}

export async function enableProject(id: string): Promise<Project> {
  const { data } = await request<{ project: Project }>(`/projects/${id}/enable`, {
    method: "POST",
  });
  return data.project;
}

export async function disableProject(id: string): Promise<Project> {
  const { data } = await request<{ project: Project }>(`/projects/${id}/disable`, {
    method: "POST",
  });
  return data.project;
}

export async function listAgents(query: ListQuery = {}): Promise<PaginatedResult<Agent>> {
  const { data } = await request<{
    agents: Agent[];
    total: number;
    limit: number;
    offset: number;
  }>(`/agents${buildListQuery(query)}`);
  return {
    items: data.agents,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function getAgent(id: string): Promise<Agent> {
  const { data } = await request<{ agent: Agent }>(`/agents/${id}`);
  return data.agent;
}

export async function runAgent(id: string): Promise<Run> {
  const { data } = await request<{ run: Run }>(`/agents/${id}/run`, { method: "POST" });
  return data.run;
}

export async function enableAgent(id: string): Promise<Agent> {
  const { data } = await request<{ agent: Agent }>(`/agents/${id}/enable`, { method: "POST" });
  return data.agent;
}

export async function disableAgent(id: string): Promise<Agent> {
  const { data } = await request<{ agent: Agent }>(`/agents/${id}/disable`, { method: "POST" });
  return data.agent;
}

export async function listSchedules(query: ListQuery = {}): Promise<PaginatedResult<Schedule>> {
  const { data } = await request<{
    schedules: Schedule[];
    total: number;
    limit: number;
    offset: number;
  }>(`/schedules${buildListQuery(query)}`);
  return {
    items: data.schedules,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function enableSchedule(id: string): Promise<Schedule> {
  const { data } = await request<{ schedule: Schedule }>(`/schedules/${id}/enable`, {
    method: "POST",
  });
  return data.schedule;
}

export async function disableSchedule(id: string): Promise<Schedule> {
  const { data } = await request<{ schedule: Schedule }>(`/schedules/${id}/disable`, {
    method: "POST",
  });
  return data.schedule;
}

export async function listAdapters(): Promise<AdapterInfo[]> {
  const { data } = await request<{ adapters: AdapterInfo[] }>("/adapters");
  return data.adapters;
}

export async function testAdapter(name: string): Promise<AdapterTestResult> {
  const { data } = await request<{ result: AdapterTestResult }>(
    `/adapters/${encodeURIComponent(name)}/test`,
    { method: "POST" },
  );
  return data.result;
}

export async function listImpactItems(
  query: ListQuery = {},
): Promise<PaginatedResult<ImpactItemListRow>> {
  const { data } = await request<{
    items: ImpactItemListRow[];
    total: number;
    limit: number;
    offset: number;
  }>(`/impact/items${buildListQuery(query)}`);
  return {
    items: data.items,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}
