import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { PlatformChangeFeed } from "@/events/platform-change-feed";
import type { Database } from "@/storage";
import {
  createRepositories,
  createWorkRepositories,
  type ProjectSource,
  type SourceConnection,
} from "@/storage";
import type { WorkItem, WorkRecheckResult, WorkResolveInput } from "@shared/work";
import {
  SourceCapabilitiesSchema,
  WorkDeliverySchema,
  WorkOutcomeSchema,
  WorkProvenanceSchema,
} from "@shared/work";

import {
  ForgejoSourceAdapter,
  GenericWebhookSourceAdapter,
  GitHubSourceAdapter,
  GitLabSourceAdapter,
} from "./providers";
import { parseRepositoryRemote, providerBaseUrl } from "./repository";
import {
  SourceAdapterRegistry,
  type NormalizedSourceItem,
  type SourceAdapter,
  type SourceGetItemResult,
} from "./types";

const ACTIVE_SYNC_INTERVAL_MS = 60_000;
const ERROR_SYNC_INTERVAL_MS = 2 * 60_000;
const TERMINAL_DELIVERIES = new Set(["merged", "closed"]);
const ACTIVE_DELIVERIES = new Set(["draft", "open", "review", "blocked"]);

export interface SourceSyncSummary {
  sourceId: string;
  upserted: number;
  errors: number;
  observedAt: string | null;
}

export interface SourceObservedItem {
  source: ProjectSource;
  connection: SourceConnection;
  adapter: SourceAdapter;
  token: string | null;
  workItem: WorkItem;
  previousLabels: string[];
}

function parseConfig(connection: SourceConnection): Record<string, unknown> {
  try {
    const parsed = JSON.parse(connection.configJson) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function defaultToken(adapter: string): string | null {
  if (adapter === "github") {
    const environmentToken = process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"];
    if (environmentToken) return environmentToken;
    try {
      const result = Bun.spawnSync({
        cmd: ["gh", "auth", "token"],
        stdout: "pipe",
        stderr: "ignore",
      });
      const token = result.exitCode === 0 ? result.stdout.toString().trim() : "";
      return token || null;
    } catch {
      return null;
    }
  }
  if (adapter === "gitlab") return process.env["GITLAB_TOKEN"] ?? null;
  if (adapter === "forgejo") {
    return process.env["FORGEJO_TOKEN"] ?? process.env["GITEA_TOKEN"] ?? null;
  }
  return null;
}

export class SourceSyncService {
  private readonly work;
  private readonly registry: SourceAdapterRegistry;
  private readonly resolveSecret:
    | ((name: string, projectId: string) => string | null)
    | null;
  private readonly resolveDefaultToken: (adapter: string) => string | null;
  private readonly platformEvents: PlatformChangeFeed | null;
  private readonly onObserved:
    | ((input: SourceObservedItem) => Promise<void>)
    | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private activeTick: Promise<void> | null = null;

  constructor(input: {
    db: Database;
    registry?: SourceAdapterRegistry;
    resolveSecret?: (name: string, projectId: string) => string | null;
    resolveDefaultToken?: (adapter: string) => string | null;
    platformEvents?: PlatformChangeFeed;
    onObserved?: (input: SourceObservedItem) => Promise<void>;
  }) {
    this.work = createWorkRepositories(input.db);
    this.registry =
      input.registry ??
      new SourceAdapterRegistry([
        new GitHubSourceAdapter(),
        new GitLabSourceAdapter(),
        new ForgejoSourceAdapter(),
        new GenericWebhookSourceAdapter(),
      ]);
    this.resolveSecret = input.resolveSecret ?? null;
    this.resolveDefaultToken = input.resolveDefaultToken ?? defaultToken;
    this.platformEvents = input.platformEvents ?? null;
    this.onObserved = input.onObserved ?? null;
  }

  start(): void {
    if (this.timer) return;
    this.runTick();
    this.timer = setInterval(() => this.runTick(), ACTIVE_SYNC_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.activeTick;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = this.work.sources.listDue(now.toISOString(), 20);
      for (const source of due) {
        await this.syncSource(source.id, now);
      }
    } finally {
      this.ticking = false;
    }
  }

  private runTick(): void {
    if (this.activeTick) return;
    this.activeTick = this.tick().finally(() => {
      this.activeTick = null;
    });
  }

  async syncSource(sourceId: string, now = new Date()): Promise<SourceSyncSummary> {
    const source = this.work.sources.findById(sourceId);
    if (!source) throw new Error(`Project source not found: ${sourceId}`);
    const connection = source.connectionId
      ? this.work.connections.findById(source.connectionId)
      : null;
    if (!connection) {
      const message = "Source connection is not configured";
      this.recordFailure(source, message, now);
      return { sourceId, upserted: 0, errors: 1, observedAt: null };
    }
    const adapter = this.registry.get(connection.adapter);
    if (!adapter) {
      const message = `Source adapter is not registered: ${connection.adapter}`;
      this.recordFailure(source, message, now);
      return { sourceId, upserted: 0, errors: 1, observedAt: null };
    }
    if (!adapter.capabilities.list) {
      this.work.sources.updateSync(source.id, {
        syncState: "current",
        observedAt: source.observedAt,
        nextSyncAt: null,
        lastError: null,
      });
      return { sourceId, upserted: 0, errors: 0, observedAt: source.observedAt };
    }

    this.work.sources.updateSync(source.id, {
      syncState: "syncing",
      lastError: null,
    });
    const config = parseConfig(connection);
    const tokenSecretName =
      typeof config["tokenSecretName"] === "string" ? config["tokenSecretName"] : null;
    const token = tokenSecretName
      ? this.resolveSecret?.(tokenSecretName, source.projectId) ?? null
      : this.resolveDefaultToken(adapter.type);
    const cursor = this.work.sync.cursor(source.id);

    try {
      const result = await adapter.listActive({
        baseUrl: connection.baseUrl ?? "",
        externalKey: source.externalKey,
        cursor: cursor?.cursor ?? null,
        token,
      });
      const beforeSync = this.work.items.listByProject(source.projectId, {
        limit: 10_000,
        offset: 0,
      }).items;
      const orphanedByNativeRef = new Map<string, typeof beforeSync>();
      const previousByNativeRef = new Map(
        beforeSync
          .filter((existing) => existing.sourceId === source.id && existing.nativeKey)
          .map((existing) => [`${existing.kind}:${existing.nativeKey}`, existing] as const),
      );
      for (const existing of beforeSync) {
        if (existing.sourceId || !existing.nativeKey) continue;
        const key = `${existing.kind}:${existing.nativeKey}`;
        const matches = orphanedByNativeRef.get(key) ?? [];
        matches.push(existing);
        orphanedByNativeRef.set(key, matches);
      }
      let observedAt: string | null = null;
      for (const item of result.items) {
        const workItem = this.upsertItem(source, item);
        for (const orphan of orphanedByNativeRef.get(`${item.kind}:${item.nativeKey}`) ?? []) {
          this.work.items.mergeInto(workItem.id, orphan.id);
        }
        this.work.events.append({
          projectId: source.projectId,
          workItemId: workItem.id,
          type: "source.observed",
          source: adapter.type,
          occurredAt: item.observedAt,
          dataJson: JSON.stringify({
            nativeKey: item.nativeKey,
            nativeState: item.nativeState,
          }),
        });
        await this.onObserved?.({
          source,
          connection,
          adapter,
          token,
          workItem,
          previousLabels:
            previousByNativeRef.get(`${item.kind}:${item.nativeKey}`)?.labels ?? [],
        });
        if (!observedAt || item.observedAt > observedAt) observedAt = item.observedAt;
      }
      const completedAt = now.toISOString();
      if (result.backfillComplete) {
        const seen = new Set(result.items.map((item) => `${item.kind}:${item.nativeKey}`));
        const sourceWebUrl = source.webUrl?.replace(/\.git\/?$/i, "").replace(/\/+$/, "");
        for (const existing of this.work.items
          .listByProject(source.projectId, { limit: 10_000, offset: 0 })
          .items.filter(
            (item) =>
              item.resolution == null &&
              (item.sourceId === source.id ||
                (item.sourceId === null &&
                  Boolean(sourceWebUrl) &&
                  Boolean(item.webUrl?.startsWith(`${sourceWebUrl}/`)))) &&
              ACTIVE_DELIVERIES.has(item.delivery),
          )) {
          if (
            !existing.nativeKey ||
            seen.has(`${existing.kind}:${existing.nativeKey}`)
          ) {
            continue;
          }
          await this.verifyAbsentItem({
            source,
            connection,
            adapter,
            token,
            workItem: existing,
            now,
          });
        }
      }
      this.work.sync.updateCursor({
        sourceId: source.id,
        cursor: result.cursor,
        backfillComplete: result.backfillComplete,
        lastSuccessAt: completedAt,
        lastError: null,
      });
      this.work.sources.updateSync(source.id, {
        syncState: "current",
        observedAt: observedAt ?? completedAt,
        nextSyncAt: new Date(now.getTime() + ACTIVE_SYNC_INTERVAL_MS).toISOString(),
        lastError: null,
      });
      this.platformEvents?.append({
        projectId: source.projectId,
        type: "source.refreshed",
        entityKind: "source",
        entityId: source.id,
        topics: ["dashboard", "overview", "impact", "projects", "work", "sources"],
        data: { upserted: result.items.length, backfillComplete: result.backfillComplete },
        occurredAt: completedAt,
      });
      return {
        sourceId,
        upserted: result.items.length,
        errors: 0,
        observedAt: observedAt ?? completedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordFailure(source, message, now);
      return { sourceId, upserted: 0, errors: 1, observedAt: source.observedAt };
    }
  }

  async recheckWorkItem(workItemId: string, now = new Date()): Promise<WorkRecheckResult> {
    const workItem = this.work.items.findById(workItemId);
    if (!workItem) {
      throw new Error(`Work item not found: ${workItemId}`);
    }
    if (!workItem.sourceId || !workItem.nativeKey) {
      return {
        status: "unresolved",
        work: workItem,
        detail: "Work item is not bound to a source-native identity",
      };
    }
    const source = this.work.sources.findById(workItem.sourceId);
    if (!source) {
      return {
        status: "unresolved",
        work: workItem,
        detail: "Project source is not configured",
      };
    }
    const connection = source.connectionId
      ? this.work.connections.findById(source.connectionId)
      : null;
    if (!connection) {
      return {
        status: "unresolved",
        work: workItem,
        detail: "Source connection is not configured",
      };
    }
    const adapter = this.registry.get(connection.adapter);
    if (!adapter?.getItem) {
      return {
        status: "unresolved",
        work: workItem,
        detail: `Source adapter does not support item verification: ${connection.adapter}`,
      };
    }
    const config = parseConfig(connection);
    const tokenSecretName =
      typeof config["tokenSecretName"] === "string" ? config["tokenSecretName"] : null;
    const token = tokenSecretName
      ? this.resolveSecret?.(tokenSecretName, source.projectId) ?? null
      : this.resolveDefaultToken(adapter.type);
    const lookup = await adapter.getItem({
      baseUrl: connection.baseUrl ?? "",
      externalKey: source.externalKey,
      kind: workItem.kind,
      nativeKey: workItem.nativeKey,
      token,
    });
    return this.applyLookup({
      source,
      workItem,
      lookup,
      now,
      eventSource: adapter.type,
    });
  }

  resolveWorkItem(workItemId: string, input: WorkResolveInput = {}): WorkItem {
    const existing = this.work.items.findById(workItemId);
    if (!existing) {
      throw new Error(`Work item not found: ${workItemId}`);
    }
    const resolved = this.work.items.resolve(workItemId, input);
    if (!resolved) {
      throw new Error(`Work item not found: ${workItemId}`);
    }
    this.work.events.append({
      projectId: resolved.projectId,
      workItemId: resolved.id,
      type: "work.resolved",
      source: "operator",
      dataJson: JSON.stringify({
        resolvedBy: input.resolvedBy ?? null,
        note: input.note ?? null,
      }),
    });
    this.platformEvents?.append({
      projectId: resolved.projectId,
      type: "work.resolved",
      entityKind: "work",
      entityId: resolved.id,
      topics: ["dashboard", "overview", "impact", "projects", "work"],
      data: { resolution: resolved.resolution },
    });
    return resolved;
  }

  private async verifyAbsentItem(input: {
    source: ProjectSource;
    connection: SourceConnection;
    adapter: SourceAdapter;
    token: string | null;
    workItem: WorkItem;
    now: Date;
  }): Promise<void> {
    const { source, connection, adapter, token, workItem, now } = input;
    if (!workItem.nativeKey) return;
    if (!adapter.getItem) {
      this.markStale(workItem, now, "No longer present in the source active-work snapshot");
      return;
    }
    let lookup: SourceGetItemResult;
    try {
      lookup = await adapter.getItem({
        baseUrl: connection.baseUrl ?? "",
        externalKey: source.externalKey,
        kind: workItem.kind,
        nativeKey: workItem.nativeKey,
        token,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.markStale(workItem, now, detail);
      return;
    }
    await this.applyLookup({
      source,
      workItem,
      lookup,
      now,
      eventSource: adapter.type,
      absentFromSnapshot: true,
    });
  }

  private applyLookup(input: {
    source: ProjectSource;
    workItem: WorkItem;
    lookup: SourceGetItemResult;
    now: Date;
    eventSource: string;
    absentFromSnapshot?: boolean;
  }): WorkRecheckResult {
    const { source, workItem, lookup, now, eventSource } = input;
    if (lookup.status === "unresolved") {
      const stale =
        this.markStale(
          workItem,
          now,
          input.absentFromSnapshot
            ? "No longer present in the source active-work snapshot"
            : lookup.detail,
        ) ?? workItem;
      return { status: "unresolved", work: stale, detail: lookup.detail };
    }

    const item = lookup.item;
    if (TERMINAL_DELIVERIES.has(item.delivery)) {
      const updated = this.work.items.update(workItem.id, {
        title: item.title,
        summary: item.summary,
        delivery: item.delivery,
        outcome: item.outcome,
        attention: "none",
        nativeState: item.nativeState,
        nativeJson: item.nativeJson,
        webUrl: item.webUrl ?? workItem.webUrl,
        observedAt: item.observedAt,
        nextSyncAt: null,
        syncState: "current",
        lastError: null,
        completedAt: item.observedAt,
      });
      if (updated?.resolution) {
        this.work.items.clearResolution(updated.id);
      }
      const terminal = this.work.items.findById(workItem.id) ?? updated ?? workItem;
      this.work.events.append({
        projectId: source.projectId,
        workItemId: terminal.id,
        type: "work.verified_terminal",
        source: eventSource,
        occurredAt: item.observedAt,
        dataJson: JSON.stringify({
          delivery: item.delivery,
          nativeKey: item.nativeKey,
          nativeState: item.nativeState,
        }),
      });
      this.platformEvents?.append({
        projectId: source.projectId,
        type: "work.verified_terminal",
        entityKind: "work",
        entityId: terminal.id,
        topics: ["dashboard", "overview", "impact", "projects", "work", "sources"],
        data: { delivery: item.delivery },
        occurredAt: item.observedAt,
      });
      return { status: "terminal", work: terminal, detail: null };
    }

    const active = this.upsertItem(source, item);
    this.work.events.append({
      projectId: source.projectId,
      workItemId: active.id,
      type: "source.observed",
      source: eventSource,
      occurredAt: item.observedAt,
      dataJson: JSON.stringify({
        nativeKey: item.nativeKey,
        nativeState: item.nativeState,
        recheck: true,
      }),
    });
    this.platformEvents?.append({
      projectId: source.projectId,
      type: "work.rechecked",
      entityKind: "work",
      entityId: active.id,
      topics: ["dashboard", "overview", "impact", "projects", "work", "sources"],
      data: { status: "active" },
      occurredAt: item.observedAt,
    });
    return { status: "active", work: active, detail: null };
  }

  private markStale(workItem: WorkItem, now: Date, detail: string): WorkItem | null {
    const updated = this.work.items.update(workItem.id, {
      attention: "stale",
      syncState: "stale",
      observedAt: now.toISOString(),
      nextSyncAt: new Date(now.getTime() + ACTIVE_SYNC_INTERVAL_MS).toISOString(),
      lastError: detail,
    });
    if (updated) {
      this.work.events.append({
        projectId: updated.projectId,
        workItemId: updated.id,
        type: "work.stale",
        source: "source-sync",
        occurredAt: now.toISOString(),
        dataJson: JSON.stringify({ detail }),
      });
      this.platformEvents?.append({
        projectId: updated.projectId,
        type: "work.stale",
        entityKind: "work",
        entityId: updated.id,
        topics: ["dashboard", "overview", "impact", "projects", "work", "sources"],
        data: { detail },
        occurredAt: now.toISOString(),
      });
    }
    return updated;
  }

  private upsertItem(source: ProjectSource, item: NormalizedSourceItem) {
    return this.work.items.upsertExternal({
      projectId: source.projectId,
      sourceId: source.id,
      kind: item.kind,
      nativeKey: item.nativeKey,
      title: item.title,
      summary: item.summary,
      delivery: item.delivery,
      outcome: item.outcome,
      provenance: item.provenance,
      actorName: item.actorName ?? null,
      labels: item.labels,
      nativeState: item.nativeState,
      nativeJson: item.nativeJson,
      webUrl: item.webUrl ?? null,
      observedAt: item.observedAt,
      syncState: "current",
      lastError: null,
      reviewJson: item.reviewJson ?? "{}",
      checksJson: item.checksJson ?? "{}",
      mergeability: item.mergeability ?? null,
      completedAt: TERMINAL_DELIVERIES.has(item.delivery) ? item.observedAt : null,
    });
  }

  private recordFailure(source: ProjectSource, message: string, now: Date): void {
    const nextSyncAt = new Date(now.getTime() + ERROR_SYNC_INTERVAL_MS).toISOString();
    this.work.sources.updateSync(source.id, {
      syncState: "error",
      nextSyncAt,
      lastError: message,
    });
    this.work.items.markSourceFailure(source.id, message, nextSyncAt);
    this.work.sync.updateCursor({
      sourceId: source.id,
      cursor: this.work.sync.cursor(source.id)?.cursor ?? null,
      backfillComplete: this.work.sync.cursor(source.id)?.backfillComplete ?? false,
      lastError: message,
    });
    this.platformEvents?.append({
      projectId: source.projectId,
      type: "source.sync_failed",
      entityKind: "source",
      entityId: source.id,
      topics: ["dashboard", "projects", "work", "sources"],
      data: { message },
      occurredAt: now.toISOString(),
    });
  }
}

const WebhookItemSchema = z.object({
  kind: z.string().min(1),
  nativeKey: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  delivery: WorkDeliverySchema.default("none"),
  outcome: WorkOutcomeSchema.default("pending"),
  provenance: WorkProvenanceSchema.default("external"),
  actorName: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  nativeState: z.string().min(1),
  nativeJson: z.unknown().optional(),
  webUrl: z.string().nullable().optional(),
});

const WebhookEnvelopeSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().datetime(),
  item: WebhookItemSchema,
});

function validSignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const supplied = signature.replace(/^sha256=/i, "");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(supplied, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export class GenericWebhookIngestor {
  private readonly work;
  private readonly resolveSecret: (name: string, projectId: string) => string | null;
  private readonly platformEvents: PlatformChangeFeed | null;

  constructor(input: {
    db: Database;
    resolveSecret: (name: string, projectId: string) => string | null;
    platformEvents?: PlatformChangeFeed;
  }) {
    this.work = createWorkRepositories(input.db);
    this.resolveSecret = input.resolveSecret;
    this.platformEvents = input.platformEvents ?? null;
  }

  async ingest(
    sourceId: string,
    body: string,
    signature: string,
  ): Promise<{ accepted: boolean; duplicate: boolean; workItemId?: string }> {
    const source = this.work.sources.findById(sourceId);
    if (!source) throw new Error(`Project source not found: ${sourceId}`);
    const connection = source.connectionId
      ? this.work.connections.findById(source.connectionId)
      : null;
    if (!connection || connection.adapter !== "generic-webhook") {
      throw new Error("Source is not a generic webhook connection");
    }
    SourceCapabilitiesSchema.parse(connection.capabilities);
    const config = parseConfig(connection);
    const secretName = config["webhookSecretName"];
    if (typeof secretName !== "string") {
      throw new Error("Generic webhook connection requires webhookSecretName");
    }
    const secret = this.resolveSecret(secretName, source.projectId);
    if (!secret || !validSignature(body, signature, secret)) {
      throw new Error("Invalid source webhook signature");
    }
    const envelope = WebhookEnvelopeSchema.parse(JSON.parse(body) as unknown);
    if (!this.work.sync.claimDelivery(source.id, envelope.id, envelope.occurredAt)) {
      return { accepted: true, duplicate: true };
    }
    const current = this.work.items
      .listByProject(source.projectId, { limit: 1000, offset: 0 })
      .items.find(
        (item) => item.sourceId === source.id && item.nativeKey === envelope.item.nativeKey,
      );
    if (current?.observedAt && current.observedAt > envelope.occurredAt) {
      return { accepted: true, duplicate: false, workItemId: current.id };
    }

    const item = this.work.items.upsertExternal({
      projectId: source.projectId,
      sourceId: source.id,
      kind: envelope.item.kind,
      nativeKey: envelope.item.nativeKey,
      title: envelope.item.title,
      summary: envelope.item.summary ?? "",
      delivery: envelope.item.delivery,
      outcome: envelope.item.outcome,
      provenance: envelope.item.provenance,
      actorName: envelope.item.actorName ?? null,
      labels: envelope.item.labels ?? [],
      nativeState: envelope.item.nativeState,
      nativeJson: JSON.stringify(envelope.item.nativeJson ?? {}),
      webUrl: envelope.item.webUrl ?? null,
      observedAt: envelope.occurredAt,
      syncState: "current",
      lastError: null,
    });
    this.work.events.append({
      projectId: source.projectId,
      workItemId: item.id,
      type: "source.webhook",
      source: "generic-webhook",
      occurredAt: envelope.occurredAt,
      dataJson: JSON.stringify({ deliveryId: envelope.id }),
    });
    this.work.sources.updateSync(source.id, {
      syncState: "current",
      observedAt: envelope.occurredAt,
      nextSyncAt: null,
      lastError: null,
    });
    this.platformEvents?.append({
      projectId: source.projectId,
      type: "source.webhook",
      entityKind: item.kind,
      entityId: item.id,
      topics: ["dashboard", "overview", "impact", "projects", "work", "sources"],
      data: { sourceId: source.id, deliveryId: envelope.id },
      occurredAt: envelope.occurredAt,
    });
    return { accepted: true, duplicate: false, workItemId: item.id };
  }
}

export function ensureProjectRepositorySource(db: Database, projectId: string): ProjectSource | null {
  const repos = createRepositories(db);
  const project = repos.projects.findById(projectId);
  if (!project) return null;
  const work = createWorkRepositories(db);

  let remote = project.remoteUrl;
  if (!remote) {
    const result = Bun.spawnSync({
      cmd: ["git", "remote", "get-url", "origin"],
      cwd: project.repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) remote = result.stdout.toString().trim();
  }
  if (!remote) return null;
  const identity = parseRepositoryRemote(remote);
  const baseUrl = providerBaseUrl(identity);
  const repositorySources = work.sources
    .listByProject(project.id)
    .filter((source) => source.kind === "repository");
  let connection =
    work.connections
      .list()
      .find(
        (item) =>
          item.adapter === identity.adapter &&
          item.baseUrl === baseUrl,
      ) ?? null;
  if (!connection) {
    connection = work.connections.create({
      name: identity.host,
      adapter: identity.adapter,
      baseUrl,
      capabilities:
        new SourceAdapterRegistry([
          new GitHubSourceAdapter(),
          new GitLabSourceAdapter(),
          new ForgejoSourceAdapter(),
        ])
          .get(identity.adapter)?.capabilities ?? {
          read: true,
          list: true,
          webhooks: true,
          write: false,
          workKinds: ["pull-request", "issue"],
        },
    });
  }
  if (!project.remoteUrl) repos.projects.update(project.id, { remoteUrl: remote });
  const configured = repositorySources.find(
    (source) =>
      source.connectionId === connection.id && source.externalKey === identity.externalKey,
  );
  if (configured) {
    for (const legacy of repositorySources.filter(
      (source) => source.id !== configured.id && !source.connectionId,
    )) {
      work.sources.consolidate(configured.id, legacy.id);
    }
    return work.sources.findById(configured.id);
  }
  const legacy = repositorySources.find((source) => !source.connectionId);
  if (legacy) {
    return work.sources.configure(legacy.id, {
      connectionId: connection.id,
      externalKey: identity.externalKey,
      displayName: identity.externalKey,
      webUrl: identity.webUrl,
      cloneUrl: identity.cloneUrl,
      defaultBranch: project.defaultBranch,
    });
  }
  return work.sources.create({
    projectId: project.id,
    connectionId: connection.id,
    kind: "repository",
    externalKey: identity.externalKey,
    displayName: identity.externalKey,
    webUrl: identity.webUrl,
    cloneUrl: identity.cloneUrl,
    defaultBranch: project.defaultBranch,
  });
}

export function defaultSourceAdapters(): SourceAdapter[] {
  return [
    new GitHubSourceAdapter(),
    new GitLabSourceAdapter(),
    new ForgejoSourceAdapter(),
    new GenericWebhookSourceAdapter(),
  ];
}
