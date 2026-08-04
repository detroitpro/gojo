/**
 * Read-model ports the execution query use cases depend on. Concrete
 * implementations wrap the current SQLite repos + fs-backed artifacts.
 */

export interface RunListItem {
  id: string;
  projectId: string;
  agentId: string;
  scheduleId: string | null;
  state: string;
  idempotencyKey: string;
  trigger: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  projectName: string | null;
  agentName: string | null;
}

export interface RunListPage {
  items: RunListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface RunDetail {
  run: RunListItem;
  attempts: unknown[];
  impactItems: unknown[];
  integration: unknown | null;
  approval: unknown | null;
}

export interface RunArtifactsRead {
  path: string;
  exists: boolean;
  handoff: unknown | null;
  validation: unknown | null;
  failure: unknown | null;
}

export interface RunDiffRead {
  files: string[];
}

export interface RunListQuery {
  limit: number;
  offset: number;
  sort: string;
  order: "asc" | "desc";
  projectId?: string | null;
  agentId?: string | null;
  state?: string | null;
  trigger?: string | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface RunReadModel {
  list(query: RunListQuery): RunListPage;
  detail(runId: string): RunDetail | null;
  artifacts(runId: string): RunArtifactsRead;
  diff(runId: string): Promise<RunDiffRead>;
}
