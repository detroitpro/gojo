import type {
  AgentInfo,
  AgentTestResult,
  ApiTokenInfo,
  Attempt,
  BackupInfo,
  BrowseRoot,
  CreatedApiToken,
  DashboardImpact,
  DashboardOverview,
  DashboardStats,
  DirectoryListing,
  HealthInfo,
  InstanceDoctorResult,
  InstanceInfo,
  NotificationChannelConfig,
  NotificationChannelMap,
  IntegrationListItem,
  Project,
  ProjectDoctorResult,
  ProjectSyncResponse,
  QueueSnapshot,
  Run,
  RunArtifactsResult,
  RunDiffResult,
  RunEvent,
  RunImpactItem,
  RunIntegration,
  Schedule,
  SchedulesUpcomingResult,
  SchedulingPolicy,
  Task,
  User,
} from "./types";
import { ApiError } from "./types";
import { buildListQuery, type ListQuery, type PaginatedResult } from "./lib/pagination";

export type { ListQuery, PaginatedResult };

const API_BASE = "/api/v1";

interface ApiSuccess<T> {
  data: T;
}

interface ApiFailure {
  error: {
    code: string;
    message: string;
  };
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; response: Response }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  const body = (await response.json()) as ApiSuccess<T> | ApiFailure;

  if (!response.ok) {
    const err = "error" in body ? body.error : { code: "unknown", message: response.statusText };
    throw new ApiError(err.code, err.message, response.status);
  }

  return { data: (body as ApiSuccess<T>).data, response };
}

export async function getHealth(): Promise<HealthInfo> {
  const { data } = await request<HealthInfo>("/health");
  return data;
}

export async function probeSetupNeeded(): Promise<boolean> {
  const response = await fetch(`${API_BASE}/setup`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (response.status === 403) {
    return false;
  }
  if (response.status === 400) {
    return true;
  }
  return false;
}

export async function setup(username: string, password: string): Promise<User> {
  const { data } = await request<{ user: User }>("/setup", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return data.user;
}

export async function login(username: string, password: string): Promise<User> {
  const { data } = await request<{ user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return data.user;
}

export async function logout(): Promise<void> {
  await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
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
  params: { projectId?: string; from?: string; to?: string } = {},
): Promise<DashboardImpact> {
  const search = new URLSearchParams();
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
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
  telemetryEnabled: boolean;
}): Promise<InstanceInfo> {
  const { data } = await request<InstanceInfo>("/instance", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data;
}

export async function getQueue(query: ListQuery = {}): Promise<QueueSnapshot> {
  const { data } = await request<QueueSnapshot>(`/queue${buildListQuery(query)}`);
  return data;
}

export async function getSchedulingPolicy(): Promise<SchedulingPolicy> {
  const { data } = await request<{ policy: SchedulingPolicy }>("/instance/scheduling");
  return data.policy;
}

export async function updateSchedulingPolicy(
  policy: SchedulingPolicy,
): Promise<SchedulingPolicy> {
  const { data } = await request<{ policy: SchedulingPolicy }>("/instance/scheduling", {
    method: "PATCH",
    body: JSON.stringify(policy),
  });
  return data.policy;
}

export async function getInstanceDoctor(): Promise<InstanceDoctorResult> {
  const { data } = await request<InstanceDoctorResult>("/instance/doctor");
  return data;
}

export async function listNotificationChannels(): Promise<NotificationChannelMap> {
  const { data } = await request<{ channels: NotificationChannelMap }>("/notification-channels");
  return data.channels;
}

export async function putNotificationChannels(
  channels: NotificationChannelMap,
): Promise<NotificationChannelMap> {
  const { data } = await request<{ channels: NotificationChannelMap }>("/notification-channels", {
    method: "PUT",
    body: JSON.stringify(channels),
  });
  return data.channels;
}

export async function testNotificationChannel(
  config: NotificationChannelConfig,
): Promise<{ ok: boolean }> {
  const { data } = await request<{ ok: boolean }>("/notification-channels/test", {
    method: "POST",
    body: JSON.stringify(config),
  });
  return data;
}

export async function listApiTokens(query: ListQuery = {}): Promise<PaginatedResult<ApiTokenInfo>> {
  const { data } = await request<{
    tokens: ApiTokenInfo[];
    total: number;
    limit: number;
    offset: number;
  }>(`/auth/tokens${buildListQuery(query)}`);
  return {
    items: data.tokens,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function createApiToken(name: string): Promise<CreatedApiToken> {
  const { data } = await request<CreatedApiToken>("/auth/tokens", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return data;
}

export async function revokeApiToken(id: string): Promise<void> {
  await request<{ revoked: boolean }>(`/auth/tokens/${id}`, { method: "DELETE" });
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

export async function listIntegrations(
  query: ListQuery & { status: "open" | "merged" },
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

export async function getProjectDoctor(id: string): Promise<ProjectDoctorResult> {
  const { data } = await request<ProjectDoctorResult>(`/projects/${id}/doctor`);
  return data;
}

export async function listTasks(query: ListQuery = {}): Promise<PaginatedResult<Task>> {
  const { data } = await request<{
    tasks: Task[];
    total: number;
    limit: number;
    offset: number;
  }>(`/tasks${buildListQuery(query)}`);
  return {
    items: data.tasks,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function getTask(id: string): Promise<Task> {
  const { data } = await request<{ task: Task }>(`/tasks/${id}`);
  return data.task;
}

export async function runTask(id: string): Promise<Run> {
  const { data } = await request<{ run: Run }>(`/tasks/${id}/run`, { method: "POST" });
  return data.run;
}

export async function enableTask(id: string): Promise<Task> {
  const { data } = await request<{ task: Task }>(`/tasks/${id}/enable`, { method: "POST" });
  return data.task;
}

export async function disableTask(id: string): Promise<Task> {
  const { data } = await request<{ task: Task }>(`/tasks/${id}/disable`, { method: "POST" });
  return data.task;
}

export async function listRuns(query: ListQuery = {}): Promise<PaginatedResult<Run>> {
  const { data } = await request<{
    runs: Run[];
    total: number;
    limit: number;
    offset: number;
  }>(`/runs${buildListQuery(query)}`);
  return {
    items: data.runs,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function getRun(id: string): Promise<{
  run: Run;
  attempts: Attempt[];
  impactItems: RunImpactItem[];
  integration: RunIntegration | null;
}> {
  const { data } = await request<{
    run: Run;
    attempts: Attempt[];
    impactItems: RunImpactItem[];
    integration: RunIntegration | null;
  }>(`/runs/${id}`);
  return data;
}

export async function cancelRun(id: string): Promise<Run> {
  const { data } = await request<{ run: Run | null }>(`/runs/${id}/cancel`, { method: "POST" });
  if (!data.run) {
    throw new ApiError("not_found", "Run not found", 404);
  }
  return data.run;
}

export async function approveRun(id: string): Promise<Run> {
  const { data } = await request<{ run: Run | null }>(`/runs/${id}/approve`, { method: "POST" });
  if (!data.run) {
    throw new ApiError("not_found", "Run not found", 404);
  }
  return data.run;
}

export async function rejectRun(id: string, reason?: string): Promise<Run> {
  const { data } = await request<{ run: Run | null }>(`/runs/${id}/reject`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
  });
  if (!data.run) {
    throw new ApiError("not_found", "Run not found", 404);
  }
  return data.run;
}

export async function retryRun(id: string): Promise<Run> {
  const { data } = await request<{ run: Run }>(`/runs/${id}/retry`, { method: "POST" });
  return data.run;
}

export async function getRunDiff(id: string): Promise<RunDiffResult> {
  const { data } = await request<RunDiffResult>(`/runs/${id}/diff`);
  return data;
}

export async function getRunArtifacts(id: string): Promise<RunArtifactsResult> {
  const { data } = await request<RunArtifactsResult>(`/runs/${id}/artifacts`);
  return data;
}

export function subscribeRunEvents(
  runId: string,
  onEvent: (event: RunEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const source = new EventSource(`${API_BASE}/runs/${runId}/events`, { withCredentials: true });
  const seenIds = new Set<number>();

  source.onmessage = (message) => {
    try {
      const raw = JSON.parse(message.data) as Record<string, unknown>;
      const idRaw = raw.id ?? (message.lastEventId ? Number(message.lastEventId) : undefined);
      const id = typeof idRaw === "number" && Number.isFinite(idRaw) ? idRaw : undefined;
      if (id != null) {
        if (seenIds.has(id)) {
          return;
        }
        seenIds.add(id);
      }
      // Normalize legacy { timestamp, payload } if a mixed client ever appears.
      const event: RunEvent = {
        ...(id != null ? { id } : {}),
        type: String(raw.type ?? ""),
        runId: String(raw.runId ?? runId),
        at: String(raw.at ?? raw.timestamp ?? ""),
        ...(raw.data !== undefined
          ? { data: raw.data }
          : raw.payload !== undefined
            ? { data: raw.payload }
            : {}),
      };
      onEvent(event);
    } catch {
      /* ignore malformed events */
    }
  };

  source.onerror = (event) => {
    // Auth failures leave readyState CLOSED; stop infinite reconnect spam.
    if (source.readyState === EventSource.CLOSED) {
      onError?.(event);
      source.close();
      return;
    }
    onError?.(event);
  };

  return () => source.close();
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

export async function listSchedulesUpcoming(query: {
  horizonHours?: number;
  projectId?: string;
  enabled?: "all" | "enabled" | "disabled" | boolean | null;
  q?: string;
} = {}): Promise<SchedulesUpcomingResult> {
  const params = new URLSearchParams();
  if (query.horizonHours != null) {
    params.set("horizonHours", String(query.horizonHours));
  }
  if (query.projectId) {
    params.set("projectId", query.projectId);
  }
  if (query.enabled === "enabled" || query.enabled === true) {
    params.set("enabled", "true");
  } else if (query.enabled === "disabled" || query.enabled === false) {
    params.set("enabled", "false");
  }
  if (query.q?.trim()) {
    params.set("q", query.q.trim());
  }
  const qs = params.toString();
  const { data } = await request<SchedulesUpcomingResult>(
    `/schedules/upcoming${qs ? `?${qs}` : ""}`,
  );
  return data;
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

export async function listAgents(): Promise<AgentInfo[]> {
  const { data } = await request<{ agents: AgentInfo[] }>("/agents");
  return data.agents;
}

export async function testAgent(name: string): Promise<AgentTestResult> {
  const { data } = await request<{ result: AgentTestResult }>(
    `/agents/${encodeURIComponent(name)}/test`,
    { method: "POST" },
  );
  return data.result;
}

export async function checkSession(): Promise<User | null> {
  try {
    await getInstance();
    return { id: "", username: "session", role: "admin" };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export { ApiError };
