import type {
  SourceCapabilities,
  SourceSyncState,
  WorkAttention,
  WorkDelivery,
  WorkExecution,
  WorkItem,
  WorkLinkType,
  WorkOutcome,
  WorkProvenance,
} from "@shared/work";

/** Persisted forge connection backing one or more project sources. */
export interface SourceConnection {
  id: string;
  name: string;
  adapter: string;
  baseUrl: string | null;
  configJson: string;
  capabilities: SourceCapabilities;
  status: SourceSyncState;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Project-scoped external work source (repo, forge project, webhook endpoint). */
export interface ProjectSource {
  id: string;
  projectId: string;
  connectionId: string | null;
  kind: string;
  externalKey: string;
  displayName: string;
  webUrl: string | null;
  cloneUrl: string | null;
  defaultBranch: string | null;
  metadataJson: string;
  syncState: SourceSyncState;
  observedAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Query parameters for listing work items within a project. */
export interface WorkListInput {
  limit: number;
  offset: number;
  kind?: string | null;
  provenance?: WorkProvenance | null;
  delivery?: WorkDelivery | null;
  attention?: WorkAttention | null;
  execution?: WorkExecution | null;
  outcome?: WorkOutcome | null;
  sourceId?: string | null;
  actor?: string | null;
  label?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  /** Completed / verified-terminal / operator-resolved history view. */
  history?: boolean;
}

export interface WorkPage {
  items: WorkItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkLink {
  id: string;
  sourceWorkItemId: string;
  targetWorkItemId: string;
  type: WorkLinkType;
  createdAt: string;
}

export interface WorkEvent {
  sequence: number;
  id: string;
  projectId: string;
  workItemId: string;
  runId: string | null;
  type: string;
  dataJson: string;
  source: string;
  occurredAt: string;
  createdAt: string;
  execution: string | null;
  delivery: string | null;
  outcome: string | null;
  attention: string | null;
  syncState: string | null;
  resolution: string | null;
  archivedAt: string | null;
}

/** Immutable enqueue-time snapshot of the run prompt and integration context. */
export interface RunContextRecord {
  runId: string;
  workItemId: string;
  agentName: string;
  agentDescription: string;
  prompt: string;
  manifestHash: string | null;
  instructions: string;
  profileJson: string;
  adapter: string | null;
  model: string | null;
  validationJson: string;
  integrationJson: string;
  failurePolicyJson: string;
  /** Non-secret env config snapshot (file + names); never resolved values. */
  environmentJson: string;
  /** Immutable enqueue-time snapshot of the issue or PR this run serves. */
  subjectJson: string | null;
  /** Existing PR branch to attach rather than creating a fresh run branch. */
  resumeBranch: string | null;
  baseBranch: string | null;
  scheduleJson: string | null;
  createdAt: string;
}
