import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { Database } from "@/storage";
import {
  createRepositories,
  createWorkRepositories,
  type ProjectSource,
  type SourceConnection,
} from "@/storage";
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
} from "./types";

const ACTIVE_SYNC_INTERVAL_MS = 60_000;
const ERROR_SYNC_INTERVAL_MS = 2 * 60_000;

export interface SourceSyncSummary {
  sourceId: string;
  upserted: number;
  errors: number;
  observedAt: string | null;
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
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private activeTick: Promise<void> | null = null;

  constructor(input: {
    db: Database;
    registry?: SourceAdapterRegistry;
    resolveSecret?: (name: string, projectId: string) => string | null;
    resolveDefaultToken?: (adapter: string) => string | null;
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
        if (!observedAt || item.observedAt > observedAt) observedAt = item.observedAt;
      }
      const completedAt = now.toISOString();
      const seen = new Set(result.items.map((item) => `${item.kind}:${item.nativeKey}`));
      const sourceWebUrl = source.webUrl?.replace(/\.git\/?$/i, "").replace(/\/+$/, "");
      for (const existing of this.work.items
        .listByProject(source.projectId, { limit: 10_000, offset: 0 })
        .items.filter(
          (item) =>
            (item.sourceId === source.id ||
              (item.sourceId === null &&
                Boolean(sourceWebUrl) &&
                Boolean(item.webUrl?.startsWith(`${sourceWebUrl}/`)))) &&
            ["draft", "open", "review", "blocked"].includes(item.delivery),
        )) {
        if (
          !existing.nativeKey ||
          seen.has(`${existing.kind}:${existing.nativeKey}`)
        ) {
          continue;
        }
        this.work.items.update(existing.id, {
          attention: "stale",
          syncState: "stale",
          observedAt: completedAt,
          nextSyncAt: new Date(now.getTime() + ACTIVE_SYNC_INTERVAL_MS).toISOString(),
          lastError: "No longer present in the source active-work snapshot",
        });
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

  constructor(input: {
    db: Database;
    resolveSecret: (name: string, projectId: string) => string | null;
  }) {
    this.work = createWorkRepositories(input.db);
    this.resolveSecret = input.resolveSecret;
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
