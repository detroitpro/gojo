import type {
  BackupInfo,
  BrowseRoot,
  DashboardImpact,
  DashboardOverview,
  DashboardStats,
  DirectoryListing,
  HealthInfo,
  InstanceDoctorResult,
  InstanceInfo,
  ProjectDoctorResult,
} from "./types";
import { httpRequest, request } from "@/infrastructure/http";
import { buildListQuery, type ListQuery, type PaginatedResult } from "@/kernel/pagination";

export async function getHealth(): Promise<HealthInfo> {
  const { data } = await httpRequest<HealthInfo>("/health");
  return data;
}

export async function getInstance(): Promise<InstanceInfo> {
  const { data } = await request<InstanceInfo>("/instance");
  return data;
}

export async function getDashboard(): Promise<DashboardStats> {
  const { data } = await request<DashboardStats>("/dashboard");
  return data;
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const { data } = await request<DashboardOverview>("/dashboard/overview");
  return data;
}

export async function getDashboardImpact(
  params: { projectId?: string; from?: string; to?: string; range?: string } = {},
): Promise<DashboardImpact> {
  const search = new URLSearchParams();
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.range) search.set("range", params.range);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const { data } = await request<DashboardImpact>(`/dashboard/impact${suffix}`);
  return data;
}

export async function pauseInstance(): Promise<void> {
  await request<{ paused: boolean }>("/instance/pause", { method: "POST" });
}

export async function resumeInstance(): Promise<void> {
  await request<{ paused: boolean }>("/instance/resume", { method: "POST" });
}

export async function updateInstance(input: {
  telemetryEnabled?: boolean;
  bindHost?: string;
  bindPort?: number;
  publicBaseUrl?: string | null;
  trustedProxies?: string[];
  allowedOrigins?: string[];
  ipAllowlist?: string[];
  cookieSecure?: InstanceInfo["cookieSecure"];
}): Promise<InstanceInfo> {
  const { data } = await request<InstanceInfo>("/instance", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data;
}

export async function getInstanceDoctor(): Promise<InstanceDoctorResult> {
  const { data } = await request<InstanceDoctorResult>("/instance/doctor");
  return data;
}

export async function listBackups(query: ListQuery = {}): Promise<PaginatedResult<BackupInfo>> {
  const { data } = await request<{
    backups: BackupInfo[];
    total: number;
    limit: number;
    offset: number;
  }>(`/backups${buildListQuery(query)}`);
  return {
    items: data.backups,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function createBackup(): Promise<{ path: string }> {
  const { data } = await request<{ path: string }>("/backups", { method: "POST" });
  return data;
}

export async function verifyBackup(path: string): Promise<{ path: string; valid: boolean }> {
  const { data } = await request<{ path: string; valid: boolean }>("/backups/verify", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
  return data;
}

export async function browseFilesystem(path?: string): Promise<{
  listing: DirectoryListing;
  roots: BrowseRoot[];
}> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const { data } = await request<{ listing: DirectoryListing; roots: BrowseRoot[] }>(
    `/filesystem${query}`,
  );
  return data;
}

export async function getProjectDoctor(id: string): Promise<ProjectDoctorResult> {
  const { data } = await request<ProjectDoctorResult>(`/projects/${id}/doctor`);
  return data;
}
