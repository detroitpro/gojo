import type {
  Run,
  RunArtifactsResult,
  RunDetail,
  RunDiffResult,
  RunEvent,
} from "./types";
import { ApiError } from "@/infrastructure/api-error";
import { request } from "@/infrastructure/http";
import { gojoSocket } from "@/infrastructure/ws-client";
import { buildListQuery, type ListQuery, type PaginatedResult } from "@/kernel/pagination";

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

export async function getRun(id: string): Promise<RunDetail> {
  const { data } = await request<RunDetail>(`/runs/${id}`);
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
  const seen = new Set<string>();
  gojoSocket.connect();
  return gojoSocket.subscribeRun(
    runId,
    (event) => {
      const key =
        event.id != null
          ? `${event.idSpace ?? "live"}:${event.id}`
          : `${event.type}:${event.at}:${JSON.stringify(event.data ?? null)}`;
      if (seen.has(key)) return;
      seen.add(key);
      onEvent(event);
    },
    onError,
  );
}
