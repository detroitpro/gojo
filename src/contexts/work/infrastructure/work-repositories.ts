/** @removal(when: work context owns WorkRepositories): dissolve createWorkRepositories bag — S1 */
import { ulid } from "ulid";

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
  WorkResolveInput,
  WorkResolution,
  WorkStatus,
  WorkStatusCompareWindow,
  WorkStatusCounts,
} from "@shared/work";
import { compareWindowToMs } from "@shared/work";

import type { Database } from "@/infrastructure/persistence/db";
import {
  WORK_STATUS_AGGREGATE_SQL,
  axesChanged,
  axesFromWorkItem,
  mapStatusCountsRow,
} from "@/contexts/work/infrastructure/work-status-counts";
import { createWorkStatusRollup } from "@/contexts/work/infrastructure/work-status-rollup";

function nowIso(): string {
  return new Date().toISOString();
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

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

export interface CreateSourceConnectionInput {
  name: string;
  adapter: string;
  baseUrl?: string | null;
  configJson?: string;
  capabilities: SourceCapabilities;
}

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

export interface CreateProjectSourceInput {
  projectId: string;
  connectionId?: string | null;
  kind: string;
  externalKey: string;
  displayName: string;
  webUrl?: string | null;
  cloneUrl?: string | null;
  defaultBranch?: string | null;
  metadataJson?: string;
}

export interface CreateWorkItemInput {
  projectId: string;
  sourceId?: string | null;
  kind: string;
  nativeKey?: string | null;
  title: string;
  summary?: string;
  execution?: WorkExecution;
  delivery?: WorkDelivery;
  outcome?: WorkOutcome;
  attention?: WorkAttention;
  provenance?: WorkProvenance;
  actorName?: string | null;
  profileId?: string | null;
  labels?: string[];
  nativeState?: string | null;
  nativeJson?: string;
  webUrl?: string | null;
  observedAt?: string | null;
  nextSyncAt?: string | null;
  syncState?: SourceSyncState;
  lastError?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface UpsertExternalWorkInput extends CreateWorkItemInput {
  sourceId: string;
  nativeKey: string;
  reviewJson?: string;
  checksJson?: string;
  mergeability?: string | null;
}

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

export type WorkStatusOptions = {
  compareWindow?: WorkStatusCompareWindow;
  now?: Date;
};

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

interface WorkItemRow {
  id: string;
  project_id: string;
  source_id: string | null;
  kind: string;
  native_key: string | null;
  title: string;
  summary: string;
  execution: WorkExecution;
  delivery: WorkDelivery;
  outcome: WorkOutcome;
  attention: WorkAttention;
  provenance: WorkProvenance;
  actor_name: string | null;
  profile_id: string | null;
  labels_json: string;
  native_state: string | null;
  native_json: string;
  web_url: string | null;
  observed_at: string | null;
  next_sync_at: string | null;
  sync_state: SourceSyncState;
  last_error: string | null;
  resolution: WorkResolution | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function mapWorkItem(row: WorkItemRow): WorkItem {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    kind: row.kind,
    nativeKey: row.native_key,
    title: row.title,
    summary: row.summary,
    execution: row.execution,
    delivery: row.delivery,
    outcome: row.outcome,
    attention: row.attention,
    provenance: row.provenance,
    actorName: row.actor_name,
    profileId: row.profile_id,
    labels: parseStringArray(row.labels_json),
    nativeState: row.native_state,
    nativeJson: row.native_json,
    webUrl: row.web_url,
    observedAt: row.observed_at,
    nextSyncAt: row.next_sync_at,
    syncState: row.sync_state,
    lastError: row.last_error,
    resolution: row.resolution ?? null,
    resolvedAt: row.resolved_at ?? null,
    resolvedBy: row.resolved_by ?? null,
    resolutionNote: row.resolution_note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function attentionForSync(
  requested: WorkAttention | undefined,
  syncState: SourceSyncState,
): WorkAttention {
  if (requested) return requested;
  if (syncState === "error") return "sync-error";
  if (syncState === "stale") return "stale";
  return "none";
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function enrichWorkAttribution(
  sqlite: ReturnType<Database["connection"]>,
  items: WorkItem[],
): WorkItem[] {
  if (items.length === 0) return items;

  const ids = items.map((item) => item.id);
  const idPlaceholders = placeholders(ids.length);

  const contexts = sqlite
    .query<{ work_item_id: string; agent_name: string; adapter: string | null }, string[]>(
      `SELECT work_item_id, agent_name, adapter
       FROM run_context
       WHERE work_item_id IN (${idPlaceholders})`,
    )
    .all(...ids);
  const contextByWorkId = new Map(
    contexts.map((row) => [row.work_item_id, row] as const),
  );

  const delivers = sqlite
    .query<
      { source_work_item_id: string; target_work_item_id: string },
      string[]
    >(
      `SELECT source_work_item_id, target_work_item_id
       FROM work_links
       WHERE type = 'delivers'
         AND target_work_item_id IN (${idPlaceholders})`,
    )
    .all(...ids);

  const delivererIds = [
    ...new Set(
      delivers
        .map((link) => link.source_work_item_id)
        .filter((id) => !contextByWorkId.has(id)),
    ),
  ];
  if (delivererIds.length > 0) {
    const extraContexts = sqlite
      .query<{ work_item_id: string; agent_name: string; adapter: string | null }, string[]>(
        `SELECT work_item_id, agent_name, adapter
         FROM run_context
         WHERE work_item_id IN (${placeholders(delivererIds.length)})`,
      )
      .all(...delivererIds);
    for (const row of extraContexts) {
      contextByWorkId.set(row.work_item_id, row);
    }
  }

  const missingDelivererIds = delivererIds.filter((id) => !contextByWorkId.has(id));
  const delivererTitleById = new Map<string, string>();
  if (missingDelivererIds.length > 0) {
    const titles = sqlite
      .query<{ id: string; title: string }, string[]>(
        `SELECT id, title FROM work_items WHERE id IN (${placeholders(missingDelivererIds.length)})`,
      )
      .all(...missingDelivererIds);
    for (const row of titles) {
      delivererTitleById.set(row.id, row.title);
    }
  }

  const agentNameByTarget = new Map<string, string>();
  for (const link of delivers) {
    const fromContext = contextByWorkId.get(link.source_work_item_id)?.agent_name;
    const fromTitle = delivererTitleById.get(link.source_work_item_id);
    const agentName = fromContext?.trim() || fromTitle?.trim();
    if (agentName) {
      agentNameByTarget.set(link.target_work_item_id, agentName);
    }
  }

  const profileIds = [
    ...new Set(
      items
        .map((item) => item.profileId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const profileById = new Map<string, { name: string; adapter: string }>();
  if (profileIds.length > 0) {
    const profiles = sqlite
      .query<{ id: string; name: string; adapter: string }, string[]>(
        `SELECT id, name, adapter FROM profiles WHERE id IN (${placeholders(profileIds.length)})`,
      )
      .all(...profileIds);
    for (const row of profiles) {
      profileById.set(row.id, { name: row.name, adapter: row.adapter });
    }
  }

  return items.map((item) => {
    const context = contextByWorkId.get(item.id);
    const profile = item.profileId
      ? profileById.get(item.profileId)
      : undefined;
    const agentName =
      item.kind === "run"
        ? context?.agent_name?.trim() || item.title
        : agentNameByTarget.get(item.id) ?? null;
    const agentLabel =
      item.actorName?.trim() ||
      profile?.name?.trim() ||
      profile?.adapter?.trim() ||
      context?.adapter?.trim() ||
      item.provenance;
    return {
      ...item,
      agentName,
      agentLabel,
    };
  });
}

function attachDeliveredWork(
  sqlite: ReturnType<Database["connection"]>,
  items: WorkItem[],
): WorkItem[] {
  const runIds = items.filter((item) => item.kind === "run").map((item) => item.id);
  if (runIds.length === 0) {
    return items;
  }

  const outbound = sqlite
    .query<
      { source_work_item_id: string; target_work_item_id: string },
      string[]
    >(
      `SELECT source_work_item_id, target_work_item_id
       FROM work_links
       WHERE type = 'delivers'
         AND source_work_item_id IN (${placeholders(runIds.length)})
       ORDER BY created_at`,
    )
    .all(...runIds);

  if (outbound.length === 0) {
    return items.map((item) =>
      item.kind === "run" ? { ...item, deliveredWork: [] } : item,
    );
  }

  const targetIds = [...new Set(outbound.map((link) => link.target_work_item_id))];
  const targetRows = sqlite
    .query<WorkItemRow, string[]>(
      `SELECT * FROM work_items
       WHERE id IN (${placeholders(targetIds.length)})
         AND archived_at IS NULL`,
    )
    .all(...targetIds);
  const targetsById = new Map(
    enrichWorkAttribution(sqlite, targetRows.map(mapWorkItem)).map(
      (item) => [item.id, item] as const,
    ),
  );

  const deliveriesBySource = new Map<string, WorkItem[]>();
  for (const link of outbound) {
    const target = targetsById.get(link.target_work_item_id);
    if (!target) continue;
    const list = deliveriesBySource.get(link.source_work_item_id) ?? [];
    list.push(target);
    deliveriesBySource.set(link.source_work_item_id, list);
  }

  return items.map((item) => {
    if (item.kind !== "run") return item;
    return {
      ...item,
      deliveredWork: deliveriesBySource.get(item.id) ?? [],
    };
  });
}

type AppendWorkEventInput = {
  projectId: string;
  workItemId: string;
  runId?: string | null;
  type: string;
  dataJson?: string;
  source: string;
  occurredAt?: string;
  execution?: string | null;
  delivery?: string | null;
  outcome?: string | null;
  attention?: string | null;
  syncState?: string | null;
  resolution?: string | null;
  archivedAt?: string | null;
};

type WorkEventRow = {
  sequence: number;
  id: string;
  project_id: string;
  work_item_id: string;
  run_id: string | null;
  type: string;
  data_json: string;
  source: string;
  occurred_at: string;
  created_at: string;
  execution: string | null;
  delivery: string | null;
  outcome: string | null;
  attention: string | null;
  sync_state: string | null;
  resolution: string | null;
  archived_at: string | null;
};

function mapWorkEvent(row: WorkEventRow): WorkEvent {
  return {
    sequence: row.sequence,
    id: row.id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    runId: row.run_id,
    type: row.type,
    dataJson: row.data_json,
    source: row.source,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    execution: row.execution ?? null,
    delivery: row.delivery ?? null,
    outcome: row.outcome ?? null,
    attention: row.attention ?? null,
    syncState: row.sync_state ?? null,
    resolution: row.resolution ?? null,
    archivedAt: row.archived_at ?? null,
  };
}

export function createWorkRepositories(db: Database) {
  const sqlite = db.connection();
  const rollup = createWorkStatusRollup(db);

  function appendWorkEvent(input: AppendWorkEventInput): WorkEvent {
    const id = ulid();
    const createdAt = nowIso();
    sqlite
      .query(
        `INSERT INTO work_events (
          id, project_id, work_item_id, run_id, type, data_json, source,
          occurred_at, created_at, execution, delivery, outcome, attention,
          sync_state, resolution, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.workItemId,
        input.runId ?? null,
        input.type,
        input.dataJson ?? "{}",
        input.source,
        input.occurredAt ?? createdAt,
        createdAt,
        input.execution ?? null,
        input.delivery ?? null,
        input.outcome ?? null,
        input.attention ?? null,
        input.syncState ?? null,
        input.resolution ?? null,
        input.archivedAt ?? null,
      );
    return mapWorkEvent(
      sqlite.query<WorkEventRow, [string]>("SELECT * FROM work_events WHERE id = ?").get(id)!,
    );
  }

  function recordStateChange(
    before: WorkItem | null,
    after: WorkItem,
    source = "gojo",
  ): void {
    const beforeAxes = before ? axesFromWorkItem(before) : null;
    const afterAxes = axesFromWorkItem(after);
    if (!axesChanged(beforeAxes, afterAxes)) return;
    appendWorkEvent({
      projectId: after.projectId,
      workItemId: after.id,
      type: "work.state_changed",
      dataJson: JSON.stringify({ kind: after.kind }),
      source,
      execution: afterAxes.execution,
      delivery: afterAxes.delivery,
      outcome: afterAxes.outcome,
      attention: afterAxes.attention,
      syncState: afterAxes.syncState,
      resolution: afterAxes.resolution,
      archivedAt: afterAxes.archivedAt,
    });
    rollup.materializeClosedHour(after.projectId);
  }

  const connections = {
    create(input: CreateSourceConnectionInput): SourceConnection {
      const existing = this.list().find(
        (connection) =>
          connection.name === input.name &&
          connection.adapter === input.adapter &&
          connection.baseUrl === (input.baseUrl ?? null),
      );
      if (existing) {
        sqlite
          .query(
            `UPDATE source_connections
             SET config_json = ?, capabilities_json = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            input.configJson ?? existing.configJson,
            JSON.stringify(input.capabilities),
            nowIso(),
            existing.id,
          );
        return this.findById(existing.id)!;
      }
      const id = ulid();
      const now = nowIso();
      sqlite
        .query(
          `INSERT INTO source_connections (
            id, name, adapter, base_url, config_json, capabilities_json, status,
            last_checked_at, last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.adapter,
          input.baseUrl ?? null,
          input.configJson ?? "{}",
          JSON.stringify(input.capabilities),
          now,
          now,
        );
      return this.findById(id)!;
    },

    findById(id: string): SourceConnection | null {
      const row = sqlite
        .query<
          {
            id: string;
            name: string;
            adapter: string;
            base_url: string | null;
            config_json: string;
            capabilities_json: string;
            status: SourceSyncState;
            last_checked_at: string | null;
            last_error: string | null;
            created_at: string;
            updated_at: string;
          },
          [string]
        >("SELECT * FROM source_connections WHERE id = ?")
        .get(id);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        adapter: row.adapter,
        baseUrl: row.base_url,
        configJson: row.config_json,
        capabilities: JSON.parse(row.capabilities_json) as SourceCapabilities,
        status: row.status,
        lastCheckedAt: row.last_checked_at,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    list(): SourceConnection[] {
      const rows = sqlite
        .query<
          {
            id: string;
            name: string;
            adapter: string;
            base_url: string | null;
            config_json: string;
            capabilities_json: string;
            status: SourceSyncState;
            last_checked_at: string | null;
            last_error: string | null;
            created_at: string;
            updated_at: string;
          },
          []
        >("SELECT * FROM source_connections ORDER BY name")
        .all();
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        adapter: row.adapter,
        baseUrl: row.base_url,
        configJson: row.config_json,
        capabilities: JSON.parse(row.capabilities_json) as SourceCapabilities,
        status: row.status,
        lastCheckedAt: row.last_checked_at,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },

    updateConfig(id: string, configJson: string): SourceConnection | null {
      const existing = this.findById(id);
      if (!existing) return null;
      sqlite
        .query("UPDATE source_connections SET config_json = ?, updated_at = ? WHERE id = ?")
        .run(configJson, nowIso(), id);
      return this.findById(id);
    },

    updateBaseUrl(id: string, baseUrl: string | null): SourceConnection | null {
      const existing = this.findById(id);
      if (!existing) return null;
      sqlite
        .query("UPDATE source_connections SET base_url = ?, updated_at = ? WHERE id = ?")
        .run(baseUrl, nowIso(), id);
      return this.findById(id);
    },
  };

  const sources = {
    create(input: CreateProjectSourceInput): ProjectSource {
      const existing = this.listByProject(input.projectId).find(
        (source) =>
          source.connectionId === (input.connectionId ?? null) &&
          source.kind === input.kind &&
          source.externalKey === input.externalKey,
      );
      if (existing) return existing;
      const id = ulid();
      const now = nowIso();
      sqlite
        .query(
          `INSERT INTO project_sources (
            id, project_id, connection_id, kind, external_key, display_name,
            web_url, clone_url, default_branch, metadata_json, sync_state,
            observed_at, next_sync_at, last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.connectionId ?? null,
          input.kind,
          input.externalKey,
          input.displayName,
          input.webUrl ?? null,
          input.cloneUrl ?? null,
          input.defaultBranch ?? null,
          input.metadataJson ?? "{}",
          now,
          now,
        );
      return this.findById(id)!;
    },

    findById(id: string): ProjectSource | null {
      const row = sqlite
        .query<
          {
            id: string;
            project_id: string;
            connection_id: string | null;
            kind: string;
            external_key: string;
            display_name: string;
            web_url: string | null;
            clone_url: string | null;
            default_branch: string | null;
            metadata_json: string;
            sync_state: SourceSyncState;
            observed_at: string | null;
            next_sync_at: string | null;
            last_error: string | null;
            created_at: string;
            updated_at: string;
          },
          [string]
        >("SELECT * FROM project_sources WHERE id = ?")
        .get(id);
      if (!row) return null;
      return {
        id: row.id,
        projectId: row.project_id,
        connectionId: row.connection_id,
        kind: row.kind,
        externalKey: row.external_key,
        displayName: row.display_name,
        webUrl: row.web_url,
        cloneUrl: row.clone_url,
        defaultBranch: row.default_branch,
        metadataJson: row.metadata_json,
        syncState: row.sync_state,
        observedAt: row.observed_at,
        nextSyncAt: row.next_sync_at,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    listByProject(projectId: string): ProjectSource[] {
      return sqlite
        .query<
          {
            id: string;
            project_id: string;
            connection_id: string | null;
            kind: string;
            external_key: string;
            display_name: string;
            web_url: string | null;
            clone_url: string | null;
            default_branch: string | null;
            metadata_json: string;
            sync_state: SourceSyncState;
            observed_at: string | null;
            next_sync_at: string | null;
            last_error: string | null;
            created_at: string;
            updated_at: string;
          },
          [string]
        >("SELECT * FROM project_sources WHERE project_id = ? ORDER BY created_at")
        .all(projectId)
        .map((row) => ({
          id: row.id,
          projectId: row.project_id,
          connectionId: row.connection_id,
          kind: row.kind,
          externalKey: row.external_key,
          displayName: row.display_name,
          webUrl: row.web_url,
          cloneUrl: row.clone_url,
          defaultBranch: row.default_branch,
          metadataJson: row.metadata_json,
          syncState: row.sync_state,
          observedAt: row.observed_at,
          nextSyncAt: row.next_sync_at,
          lastError: row.last_error,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
    },

    listDue(now: string, limit = 20): ProjectSource[] {
      return sqlite
        .query<
          {
            id: string;
            project_id: string;
            connection_id: string | null;
            kind: string;
            external_key: string;
            display_name: string;
            web_url: string | null;
            clone_url: string | null;
            default_branch: string | null;
            metadata_json: string;
            sync_state: SourceSyncState;
            observed_at: string | null;
            next_sync_at: string | null;
            last_error: string | null;
            created_at: string;
            updated_at: string;
          },
          [string, number]
        >(
          `SELECT * FROM project_sources
           WHERE next_sync_at IS NULL OR next_sync_at <= ?
           ORDER BY COALESCE(next_sync_at, created_at) LIMIT ?`,
        )
        .all(now, limit)
        .map((row) => ({
          id: row.id,
          projectId: row.project_id,
          connectionId: row.connection_id,
          kind: row.kind,
          externalKey: row.external_key,
          displayName: row.display_name,
          webUrl: row.web_url,
          cloneUrl: row.clone_url,
          defaultBranch: row.default_branch,
          metadataJson: row.metadata_json,
          syncState: row.sync_state,
          observedAt: row.observed_at,
          nextSyncAt: row.next_sync_at,
          lastError: row.last_error,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
    },

    consolidate(primaryId: string, duplicateId: string): ProjectSource | null {
      if (primaryId === duplicateId) return this.findById(primaryId);
      const primary = this.findById(primaryId);
      const duplicate = this.findById(duplicateId);
      if (!primary || !duplicate) return primary;
      if (primary.projectId !== duplicate.projectId || primary.kind !== duplicate.kind) {
        throw new Error("Cannot consolidate unrelated project sources");
      }
      const now = nowIso();
      const superseded = `Superseded by source ${primary.id}`;
      db.transaction(() => {
        const colliding = sqlite
          .query<WorkItemRow, [string, string]>(
            `SELECT * FROM work_items
             WHERE source_id = ?
               AND native_key IN (
                 SELECT native_key FROM work_items WHERE source_id = ?
               )`,
          )
          .all(duplicate.id, primary.id);
        // Preserve any colliding historical rows as stale, source-less records.
        sqlite
          .query(
            `UPDATE external_resources
             SET source_id = NULL, sync_state = 'stale', last_error = ?, updated_at = ?
             WHERE source_id = ?
               AND native_key IN (
                 SELECT native_key FROM external_resources WHERE source_id = ?
               )`,
          )
          .run(superseded, now, duplicate.id, primary.id);
        sqlite
          .query(
            `UPDATE work_items
             SET source_id = NULL, sync_state = 'stale', attention = 'stale',
               last_error = ?, updated_at = ?
             WHERE source_id = ?
               AND native_key IN (
                 SELECT native_key FROM work_items WHERE source_id = ?
               )`,
          )
          .run(superseded, now, duplicate.id, primary.id);
        for (const row of colliding) {
          const afterRow = sqlite
            .query<WorkItemRow, [string]>("SELECT * FROM work_items WHERE id = ?")
            .get(row.id);
          if (afterRow) recordStateChange(mapWorkItem(row), mapWorkItem(afterRow));
        }
        sqlite
          .query("UPDATE external_resources SET source_id = ? WHERE source_id = ?")
          .run(primary.id, duplicate.id);
        sqlite
          .query("UPDATE work_items SET source_id = ? WHERE source_id = ?")
          .run(primary.id, duplicate.id);
        sqlite.query("DELETE FROM project_sources WHERE id = ?").run(duplicate.id);
      });
      return this.findById(primary.id);
    },

    updateSync(
      id: string,
      input: {
        syncState: SourceSyncState;
        observedAt?: string | null;
        nextSyncAt?: string | null;
        lastError?: string | null;
      },
    ): ProjectSource | null {
      const existing = this.findById(id);
      if (!existing) return null;
      sqlite
        .query(
          `UPDATE project_sources
           SET sync_state = ?, observed_at = ?, next_sync_at = ?, last_error = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.syncState,
          input.observedAt === undefined ? existing.observedAt : input.observedAt,
          input.nextSyncAt === undefined ? existing.nextSyncAt : input.nextSyncAt,
          input.lastError === undefined ? existing.lastError : input.lastError,
          nowIso(),
          id,
        );
      return this.findById(id);
    },

    configure(
      id: string,
      input: {
        connectionId: string;
        externalKey: string;
        displayName: string;
        webUrl: string;
        cloneUrl: string;
        defaultBranch: string;
      },
    ): ProjectSource | null {
      sqlite
        .query(
          `UPDATE project_sources
           SET connection_id = ?, external_key = ?, display_name = ?, web_url = ?,
             clone_url = ?, default_branch = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.connectionId,
          input.externalKey,
          input.displayName,
          input.webUrl,
          input.cloneUrl,
          input.defaultBranch,
          nowIso(),
          id,
        );
      return this.findById(id);
    },
  };

  const items = {
    create(input: CreateWorkItemInput): WorkItem {
      const id = ulid();
      const now = nowIso();
      const syncState = input.syncState ?? "current";
      sqlite
        .query(
          `INSERT INTO work_items (
            id, project_id, source_id, kind, native_key, title, summary,
            execution, delivery, outcome, attention, provenance, actor_name,
            profile_id, labels_json, native_state, native_json, web_url,
            observed_at, next_sync_at, sync_state, last_error, created_at,
            updated_at, started_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.sourceId ?? null,
          input.kind,
          input.nativeKey ?? null,
          input.title,
          input.summary ?? "",
          input.execution ?? "none",
          input.delivery ?? "none",
          input.outcome ?? "pending",
          attentionForSync(input.attention, syncState),
          input.provenance ?? "external",
          input.actorName ?? null,
          input.profileId ?? null,
          JSON.stringify(input.labels ?? []),
          input.nativeState ?? null,
          input.nativeJson ?? "{}",
          input.webUrl ?? null,
          input.observedAt ?? null,
          input.nextSyncAt ?? null,
          syncState,
          input.lastError ?? null,
          now,
          now,
          input.startedAt ?? null,
          input.completedAt ?? null,
        );
      const created = this.findById(id)!;
      recordStateChange(null, created);
      return created;
    },

    findById(id: string): WorkItem | null {
      const row = sqlite
        .query<WorkItemRow, [string]>(
          "SELECT * FROM work_items WHERE id = ? AND archived_at IS NULL",
        )
        .get(id);
      return row ? mapWorkItem(row) : null;
    },

    findByWebUrl(webUrl: string): WorkItem | null {
      const row = sqlite
        .query<WorkItemRow, [string]>(
          "SELECT * FROM work_items WHERE web_url = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1",
        )
        .get(webUrl);
      return row ? mapWorkItem(row) : null;
    },

    upsertExternal(input: UpsertExternalWorkInput): WorkItem {
      return db.transaction(() => {
        const existing = sqlite
          .query<WorkItemRow, [string, string]>(
            "SELECT * FROM work_items WHERE source_id = ? AND native_key = ?",
          )
          .get(input.sourceId, input.nativeKey);
        const syncState = input.syncState ?? "current";
        const attention = attentionForSync(input.attention, syncState);
        const now = nowIso();
        const reopen =
          syncState === "current" &&
          existing?.resolution != null &&
          ["draft", "open", "review", "blocked"].includes(
            input.delivery ?? existing.delivery,
          );
        const incomingProvenance = input.provenance ?? existing?.provenance ?? "external";
        // Never downgrade coordinator-owned gojo-agent work when a forge user login
        // would otherwise reclassify the PR as human/bot/external.
        const nextProvenance: WorkProvenance =
          existing?.provenance === "gojo-agent" && incomingProvenance !== "gojo-agent"
            ? "gojo-agent"
            : incomingProvenance;
        const before = existing ? mapWorkItem(existing) : null;
        const workItem = existing
          ? (() => {
              sqlite
                .query(
                  `UPDATE work_items SET
                    kind = ?, title = ?, summary = ?, execution = ?, delivery = ?,
                    outcome = ?, attention = ?, provenance = ?, actor_name = ?,
                    profile_id = ?, labels_json = ?, native_state = ?,
                    native_json = ?, web_url = ?, observed_at = ?, next_sync_at = ?,
                    sync_state = ?, last_error = ?,
                    resolution = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?,
                    updated_at = ?, started_at = ?, completed_at = ?
                  WHERE id = ?`,
                )
                .run(
                  input.kind,
                  input.title,
                  input.summary ?? existing.summary,
                  input.execution ?? existing.execution,
                  input.delivery ?? existing.delivery,
                  input.outcome ?? existing.outcome,
                  attention,
                  nextProvenance,
                  input.actorName === undefined ? existing.actor_name : input.actorName,
                  input.profileId === undefined
                    ? existing.profile_id
                    : input.profileId,
                  JSON.stringify(input.labels ?? parseStringArray(existing.labels_json)),
                  input.nativeState === undefined ? existing.native_state : input.nativeState,
                  input.nativeJson ?? existing.native_json,
                  input.webUrl === undefined ? existing.web_url : input.webUrl,
                  input.observedAt === undefined ? existing.observed_at : input.observedAt,
                  input.nextSyncAt === undefined ? existing.next_sync_at : input.nextSyncAt,
                  syncState,
                  input.lastError === undefined ? existing.last_error : input.lastError,
                  reopen ? null : existing.resolution,
                  reopen ? null : existing.resolved_at,
                  reopen ? null : existing.resolved_by,
                  reopen ? null : existing.resolution_note,
                  now,
                  input.startedAt === undefined ? existing.started_at : input.startedAt,
                  input.completedAt === undefined ? existing.completed_at : input.completedAt,
                  existing.id,
                );
              const updated = this.findById(existing.id)!;
              recordStateChange(before, updated);
              return updated;
            })()
          : this.create(input);

        sqlite
          .query(
            `INSERT INTO external_resources (
              id, work_item_id, source_id, native_key, kind, native_state,
              author_name, provenance, labels_json, review_json, checks_json,
              mergeability, web_url, native_json, observed_at, next_sync_at,
              sync_state, last_error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(work_item_id) DO UPDATE SET
              native_state = excluded.native_state,
              author_name = excluded.author_name,
              provenance = excluded.provenance,
              labels_json = excluded.labels_json,
              review_json = excluded.review_json,
              checks_json = excluded.checks_json,
              mergeability = excluded.mergeability,
              web_url = excluded.web_url,
              native_json = excluded.native_json,
              observed_at = excluded.observed_at,
              next_sync_at = excluded.next_sync_at,
              sync_state = excluded.sync_state,
              last_error = excluded.last_error,
              updated_at = excluded.updated_at`,
          )
          .run(
            `resource:${workItem.id}`,
            workItem.id,
            input.sourceId,
            input.nativeKey,
            input.kind,
            input.nativeState ?? null,
            input.actorName ?? null,
            input.provenance ?? "external",
            JSON.stringify(input.labels ?? []),
            input.reviewJson ?? "{}",
            input.checksJson ?? "{}",
            input.mergeability ?? null,
            input.webUrl ?? null,
            input.nativeJson ?? "{}",
            input.observedAt ?? null,
            input.nextSyncAt ?? null,
            syncState,
            input.lastError ?? null,
            workItem.createdAt,
            now,
          );
        return this.findById(workItem.id)!;
      });
    },

    update(
      id: string,
      input: Partial<
        Pick<
          WorkItem,
          | "title"
          | "summary"
          | "execution"
          | "delivery"
          | "outcome"
          | "attention"
          | "labels"
          | "nativeState"
          | "nativeJson"
          | "webUrl"
          | "observedAt"
          | "nextSyncAt"
          | "syncState"
          | "lastError"
          | "startedAt"
          | "completedAt"
        >
      >,
    ): WorkItem | null {
      const existing = this.findById(id);
      if (!existing) return null;
      sqlite
        .query(
          `UPDATE work_items SET
            title = ?, summary = ?, execution = ?, delivery = ?, outcome = ?,
            attention = ?, labels_json = ?, native_state = ?, native_json = ?, web_url = ?,
            observed_at = ?, next_sync_at = ?, sync_state = ?, last_error = ?,
            started_at = ?, completed_at = ?, updated_at = ?
          WHERE id = ?`,
        )
        .run(
          input.title ?? existing.title,
          input.summary ?? existing.summary,
          input.execution ?? existing.execution,
          input.delivery ?? existing.delivery,
          input.outcome ?? existing.outcome,
          input.attention ?? existing.attention,
          JSON.stringify(input.labels ?? existing.labels),
          input.nativeState === undefined ? existing.nativeState : input.nativeState,
          input.nativeJson ?? existing.nativeJson,
          input.webUrl === undefined ? existing.webUrl : input.webUrl,
          input.observedAt === undefined ? existing.observedAt : input.observedAt,
          input.nextSyncAt === undefined ? existing.nextSyncAt : input.nextSyncAt,
          input.syncState ?? existing.syncState,
          input.lastError === undefined ? existing.lastError : input.lastError,
          input.startedAt === undefined ? existing.startedAt : input.startedAt,
          input.completedAt === undefined ? existing.completedAt : input.completedAt,
          nowIso(),
          id,
        );
      const updated = this.findById(id);
      if (updated) recordStateChange(existing, updated);
      return updated;
    },

    mergeInto(canonicalId: string, duplicateId: string): WorkItem | null {
      if (canonicalId === duplicateId) return this.findById(canonicalId);
      const canonical = this.findById(canonicalId);
      const duplicate = this.findById(duplicateId);
      if (!canonical || !duplicate) return canonical;
      if (
        canonical.projectId !== duplicate.projectId ||
        canonical.kind !== duplicate.kind ||
        canonical.nativeKey !== duplicate.nativeKey
      ) {
        throw new Error("Cannot merge unrelated work items");
      }
      db.transaction(() => {
        sqlite
          .query(
            `DELETE FROM work_links
             WHERE source_work_item_id = ? AND (
               target_work_item_id = ? OR EXISTS (
                 SELECT 1 FROM work_links existing
                 WHERE existing.source_work_item_id = ?
                   AND existing.target_work_item_id = work_links.target_work_item_id
                   AND existing.type = work_links.type
               )
             )`,
          )
          .run(duplicate.id, canonical.id, canonical.id);
        sqlite
          .query(
            "UPDATE work_links SET source_work_item_id = ? WHERE source_work_item_id = ?",
          )
          .run(canonical.id, duplicate.id);
        sqlite
          .query(
            `DELETE FROM work_links
             WHERE target_work_item_id = ? AND (
               source_work_item_id = ? OR EXISTS (
                 SELECT 1 FROM work_links existing
                 WHERE existing.target_work_item_id = ?
                   AND existing.source_work_item_id = work_links.source_work_item_id
                   AND existing.type = work_links.type
               )
             )`,
          )
          .run(duplicate.id, canonical.id, canonical.id);
        sqlite
          .query(
            "UPDATE work_links SET target_work_item_id = ? WHERE target_work_item_id = ?",
          )
          .run(canonical.id, duplicate.id);
        sqlite
          .query("UPDATE work_events SET work_item_id = ? WHERE work_item_id = ?")
          .run(canonical.id, duplicate.id);
        sqlite
          .query("DELETE FROM external_resources WHERE work_item_id = ?")
          .run(duplicate.id);
        sqlite.query("DELETE FROM work_items WHERE id = ?").run(duplicate.id);
      });
      return this.findById(canonical.id);
    },

    resolve(id: string, input: WorkResolveInput = {}): WorkItem | null {
      const existing = this.findById(id);
      if (!existing) return null;
      if (existing.resolution === "operator") {
        return existing;
      }
      const now = nowIso();
      sqlite
        .query(
          `UPDATE work_items SET
            attention = 'none',
            resolution = 'operator',
            resolved_at = ?,
            resolved_by = ?,
            resolution_note = ?,
            last_error = NULL,
            updated_at = ?
          WHERE id = ?`,
        )
        .run(now, input.resolvedBy ?? null, input.note ?? null, now, id);
      const updated = this.findById(id);
      if (updated) recordStateChange(existing, updated);
      return updated;
    },

    clearResolution(id: string): WorkItem | null {
      const existing = this.findById(id);
      if (!existing || existing.resolution == null) return existing;
      sqlite
        .query(
          `UPDATE work_items SET
            resolution = NULL, resolved_at = NULL, resolved_by = NULL,
            resolution_note = NULL, updated_at = ?
          WHERE id = ?`,
        )
        .run(nowIso(), id);
      const updated = this.findById(id);
      if (updated) recordStateChange(existing, updated);
      return updated;
    },

    markSourceFailure(sourceId: string, message: string, nextSyncAt: string): void {
      const now = nowIso();
      const beforeRows = sqlite
        .query<WorkItemRow, [string]>(
          `SELECT * FROM work_items
           WHERE source_id = ? AND archived_at IS NULL
             AND resolution IS NULL
             AND delivery IN ('draft', 'open', 'review', 'blocked')`,
        )
        .all(sourceId);
      sqlite
        .query(
          `UPDATE work_items
           SET attention = 'sync-error', sync_state = 'error', next_sync_at = ?,
             last_error = ?, updated_at = ?
           WHERE source_id = ? AND archived_at IS NULL
             AND resolution IS NULL
             AND delivery IN ('draft', 'open', 'review', 'blocked')`,
        )
        .run(nextSyncAt, message, now, sourceId);
      sqlite
        .query(
          `UPDATE external_resources
           SET sync_state = 'error', next_sync_at = ?, last_error = ?, updated_at = ?
           WHERE source_id = ?
             AND work_item_id IN (
               SELECT id FROM work_items
               WHERE source_id = ?
                 AND delivery IN ('draft', 'open', 'review', 'blocked')
             )`,
        )
        .run(nextSyncAt, message, now, sourceId, sourceId);
      for (const row of beforeRows) {
        const after = this.findById(row.id);
        if (after) recordStateChange(mapWorkItem(row), after);
      }
    },

    listByProject(projectId: string, input: WorkListInput): WorkPage {
      const clauses = ["project_id = ?", "archived_at IS NULL"];
      const values: Array<string | number> = [projectId];
      if (input.kind) {
        clauses.push("kind = ?");
        values.push(input.kind);
      }
      if (input.provenance) {
        clauses.push("provenance = ?");
        values.push(input.provenance);
      }
      if (input.delivery) {
        clauses.push("delivery = ?");
        values.push(input.delivery);
      }
      if (input.attention) {
        clauses.push("attention = ?");
        values.push(input.attention);
      }
      if (input.execution) {
        clauses.push("execution = ?");
        values.push(input.execution);
      }
      if (input.outcome) {
        clauses.push("outcome = ?");
        values.push(input.outcome);
      }
      if (input.sourceId) {
        clauses.push("source_id = ?");
        values.push(input.sourceId);
      }
      if (input.actor) {
        clauses.push("(actor_name = ? OR profile_id = ?)");
        values.push(input.actor, input.actor);
      }
      if (input.label) {
        clauses.push("EXISTS (SELECT 1 FROM json_each(labels_json) WHERE value = ?)");
        values.push(input.label);
      }
      if (input.from) {
        clauses.push("updated_at >= ?");
        values.push(input.from);
      }
      if (input.to) {
        clauses.push("updated_at <= ?");
        values.push(input.to);
      }
      const q = input.q?.trim();
      if (q) {
        clauses.push("(title LIKE ? OR summary LIKE ? OR COALESCE(native_key, '') LIKE ?)");
        const pattern = `%${q}%`;
        values.push(pattern, pattern, pattern);
      }
      if (input.history) {
        clauses.push(
          `(resolution IS NOT NULL
            OR execution = 'terminal'
            OR delivery IN ('merged', 'closed'))`,
        );
      }
      const where = clauses.join(" AND ");
      const orderBy = input.history
        ? "COALESCE(resolved_at, completed_at, updated_at) DESC, id DESC"
        : "updated_at DESC, id DESC";
      const total =
        sqlite
          .query<{ count: number }, Array<string | number>>(
            `SELECT COUNT(*) AS count FROM work_items WHERE ${where}`,
          )
          .get(...values)?.count ?? 0;
      const rows = sqlite
        .query<WorkItemRow, Array<string | number>>(
          `SELECT * FROM work_items
           WHERE ${where}
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`,
        )
        .all(...values, input.limit, input.offset);
      return {
        items: attachDeliveredWork(
          sqlite,
          enrichWorkAttribution(sqlite, rows.map(mapWorkItem)),
        ),
        total,
        limit: input.limit,
        offset: input.offset,
      };
    },

    status(projectId: string, options: WorkStatusOptions = {}): WorkStatus {
      const compareWindow = options.compareWindow ?? "24h";
      const now = options.now ?? new Date();
      const row = sqlite
        .query<
          {
            working: number;
            queued: number;
            needs_attention: number;
            verified_open: number;
            stale_open: number;
            as_of: string | null;
          },
          [string]
        >(
          `SELECT
            ${WORK_STATUS_AGGREGATE_SQL},
            MAX(observed_at) AS as_of
          FROM work_items
          WHERE project_id = ? AND archived_at IS NULL`,
        )
        .get(projectId);
      const current = mapStatusCountsRow(row);
      const previousAsOf = new Date(
        now.getTime() - compareWindowToMs(compareWindow),
      ).toISOString();
      let previous: WorkStatusCounts | null = null;
      try {
        previous = rollup.countsAt(projectId, previousAsOf);
      } catch {
        previous = null;
      }
      // No history yet — treat as unavailable rather than zeros.
      const hasHistory =
        sqlite
          .query<{ n: number }, [string]>(
            `SELECT COUNT(*) AS n FROM work_events
             WHERE project_id = ? AND execution IS NOT NULL`,
          )
          .get(projectId)?.n ?? 0;
      return {
        ...current,
        asOf: row?.as_of ?? null,
        previous: hasHistory > 0 ? previous : null,
        previousAsOf: hasHistory > 0 ? previousAsOf : null,
        compareWindow,
      };
    },
  };

  const links = {
    create(
      sourceWorkItemId: string,
      targetWorkItemId: string,
      type: WorkLinkType,
    ): WorkLink {
      const id = ulid();
      const createdAt = nowIso();
      sqlite
        .query(
          `INSERT INTO work_links (
            id, source_work_item_id, target_work_item_id, type, created_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(source_work_item_id, target_work_item_id, type) DO NOTHING`,
        )
        .run(id, sourceWorkItemId, targetWorkItemId, type, createdAt);
      return this.listByWorkItem(sourceWorkItemId).find(
        (link) =>
          link.targetWorkItemId === targetWorkItemId && link.type === type,
      )!;
    },

    listByWorkItem(workItemId: string): WorkLink[] {
      return sqlite
        .query<
          {
            id: string;
            source_work_item_id: string;
            target_work_item_id: string;
            type: WorkLinkType;
            created_at: string;
          },
          [string, string]
        >(
          `SELECT * FROM work_links
           WHERE source_work_item_id = ? OR target_work_item_id = ?
           ORDER BY created_at`,
        )
        .all(workItemId, workItemId)
        .map((row) => ({
          id: row.id,
          sourceWorkItemId: row.source_work_item_id,
          targetWorkItemId: row.target_work_item_id,
          type: row.type,
          createdAt: row.created_at,
        }));
    },
  };

  const events = {
    append(input: AppendWorkEventInput): WorkEvent {
      return appendWorkEvent(input);
    },

    listByWorkItem(workItemId: string, afterSequence = 0, limit = 500): WorkEvent[] {
      return sqlite
        .query<WorkEventRow, [string, number, number]>(
          `SELECT * FROM work_events
           WHERE work_item_id = ? AND sequence > ?
           ORDER BY sequence LIMIT ?`,
        )
        .all(workItemId, afterSequence, limit)
        .map(mapWorkEvent);
    },

    listByProject(projectId: string, afterSequence = 0, limit = 500): WorkEvent[] {
      return sqlite
        .query<WorkEventRow, [string, number, number]>(
          `SELECT * FROM work_events
           WHERE project_id = ? AND sequence > ?
           ORDER BY sequence LIMIT ?`,
        )
        .all(projectId, afterSequence, limit)
        .map(mapWorkEvent);
    },
  };

  const sync = {
    updateCursor(input: {
      sourceId: string;
      cursor: string | null;
      backfillComplete: boolean;
      lastSuccessAt?: string | null;
      lastError?: string | null;
    }): void {
      const now = nowIso();
      sqlite
        .query(
          `INSERT INTO source_sync_cursors (
            source_id, cursor, backfill_complete, rate_limit_json,
            last_success_at, last_error_at, last_error, updated_at
          ) VALUES (?, ?, ?, '{}', ?, ?, ?, ?)
          ON CONFLICT(source_id) DO UPDATE SET
            cursor = excluded.cursor,
            backfill_complete = excluded.backfill_complete,
            last_success_at = excluded.last_success_at,
            last_error_at = excluded.last_error_at,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at`,
        )
        .run(
          input.sourceId,
          input.cursor,
          input.backfillComplete ? 1 : 0,
          input.lastSuccessAt ?? null,
          input.lastError ? now : null,
          input.lastError ?? null,
          now,
        );
    },

    cursor(sourceId: string): {
      cursor: string | null;
      backfillComplete: boolean;
    } | null {
      const row = sqlite
        .query<
          { cursor: string | null; backfill_complete: number },
          [string]
        >(
          `SELECT cursor, backfill_complete
           FROM source_sync_cursors WHERE source_id = ?`,
        )
        .get(sourceId);
      return row
        ? { cursor: row.cursor, backfillComplete: row.backfill_complete !== 0 }
        : null;
    },

    claimDelivery(sourceId: string, deliveryId: string, occurredAt: string): boolean {
      const result = sqlite
        .query(
          `INSERT OR IGNORE INTO source_webhook_deliveries (
            source_id, delivery_id, occurred_at, received_at
          ) VALUES (?, ?, ?, ?)`,
        )
        .run(sourceId, deliveryId, occurredAt, nowIso());
      return result.changes > 0;
    },
  };

  const runContexts = {
    create(input: Omit<RunContextRecord, "createdAt">): RunContextRecord {
      const createdAt = nowIso();
      sqlite
        .query(
          `INSERT OR IGNORE INTO run_context (
            run_id, work_item_id, agent_name, agent_description, prompt,
            manifest_hash, instructions, profile_json, adapter, model,
            validation_json, integration_json, failure_policy_json,
            environment_json, subject_json, resume_branch, base_branch, schedule_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.runId,
          input.workItemId,
          input.agentName,
          input.agentDescription,
          input.prompt,
          input.manifestHash,
          input.instructions,
          input.profileJson,
          input.adapter,
          input.model,
          input.validationJson,
          input.integrationJson,
          input.failurePolicyJson,
          input.environmentJson,
          input.subjectJson,
          input.resumeBranch,
          input.baseBranch,
          input.scheduleJson,
          createdAt,
        );
      return this.findByRun(input.runId)!;
    },

    findByRun(runId: string): RunContextRecord | null {
      const row = sqlite
        .query<
          {
            run_id: string;
            work_item_id: string;
            agent_name: string;
            agent_description: string;
            prompt: string;
            manifest_hash: string | null;
            instructions: string;
            profile_json: string;
            adapter: string | null;
            model: string | null;
            validation_json: string;
            integration_json: string;
            failure_policy_json: string;
            environment_json: string;
            subject_json: string | null;
            resume_branch: string | null;
            base_branch: string | null;
            schedule_json: string | null;
            created_at: string;
          },
          [string]
        >("SELECT * FROM run_context WHERE run_id = ?")
        .get(runId);
      if (!row) return null;
      return {
        runId: row.run_id,
        workItemId: row.work_item_id,
        agentName: row.agent_name,
        agentDescription: row.agent_description,
        prompt: row.prompt,
        manifestHash: row.manifest_hash,
        instructions: row.instructions,
        profileJson: row.profile_json,
        adapter: row.adapter,
        model: row.model,
        validationJson: row.validation_json,
        integrationJson: row.integration_json,
        failurePolicyJson: row.failure_policy_json,
        environmentJson: row.environment_json ?? "{}",
        subjectJson: row.subject_json,
        resumeBranch: row.resume_branch,
        baseBranch: row.base_branch,
        scheduleJson: row.schedule_json,
        createdAt: row.created_at,
      };
    },
  };

  return { connections, sources, items, links, events, sync, runContexts, rollup };
}

export type WorkRepositories = ReturnType<typeof createWorkRepositories>;
