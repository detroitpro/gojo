import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { PlatformChangeFeed } from "@/platform/events/platform-change-feed";
import {
  GenericWebhookIngestor,
  GitLabSourceAdapter,
  SourceAdapterRegistry,
  SourceSyncService,
  ensureProjectRepositorySource,
  parseRepositoryRemote,
  type SourceAdapter,
} from "@/contexts/work/sources";
import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from "@/infrastructure/persistence";
import { createWorkRepositories } from "@/contexts/work/contract";

function seedSource(db: Database, adapter = "gitlab") {
  const repos = createRepositories(db);
  const project = repos.projects.create({
    name: "source-runtime",
    repoPath: "/tmp/source-runtime",
  });
  const work = createWorkRepositories(db);
  const connection = work.connections.create({
    name: adapter,
    adapter,
    baseUrl: "https://gitlab.example.com",
    configJson: JSON.stringify({ webhookSecretName: "source-webhook" }),
    capabilities: {
      read: true,
      list: true,
      webhooks: true,
      write: false,
      workKinds: ["pull-request", "issue"],
    },
  });
  const source = work.sources.create({
    projectId: project.id,
    connectionId: connection.id,
    kind: "repository",
    externalKey: "acme/app",
    displayName: "acme/app",
    webUrl: "https://gitlab.example.com/acme/app",
  });
  return { project, connection, source, work };
}

describe("sources/repository identity", () => {
  test("normalizes HTTPS, SCP-style SSH, and self-hosted remotes", () => {
    expect(parseRepositoryRemote("https://github.com/acme/app.git")).toMatchObject({
      adapter: "github",
      host: "github.com",
      externalKey: "acme/app",
    });
    expect(parseRepositoryRemote("git@gitlab.com:acme/group/app.git")).toMatchObject({
      adapter: "gitlab",
      externalKey: "acme/group/app",
    });
    expect(
      parseRepositoryRemote("ssh://git@forge.acme.test/acme/app.git", "forgejo"),
    ).toMatchObject({
      adapter: "forgejo",
      host: "forge.acme.test",
      externalKey: "acme/app",
    });
  });
});

describe("sources/GitLab adapter", () => {
  test("normalizes merge requests and issues without losing native state", async () => {
    const adapter = new GitLabSourceAdapter();
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("merge_requests")) {
        return Response.json([
          {
            iid: 7,
            title: "Ship work ledger",
            state: "opened",
            draft: false,
            web_url: "https://gitlab.example.com/acme/app/-/merge_requests/7",
            updated_at: "2026-07-27T16:00:00.000Z",
            author: { name: "A. Agent", bot: true },
            labels: ["area:platform"],
            merge_status: "can_be_merged",
          },
        ]);
      }
      return Response.json([
        {
          iid: 7,
          title: "Track rollout",
          state: "opened",
          web_url: "https://gitlab.example.com/acme/app/-/issues/12",
          updated_at: "2026-07-27T16:01:00.000Z",
          author: { name: "Operator" },
          labels: ["status:ready"],
        },
      ]);
    }) as typeof fetch;

    const result = await adapter.listActive({
      baseUrl: "https://gitlab.example.com",
      externalKey: "acme/app",
      fetchImpl,
      token: "token",
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      kind: "pull-request",
      nativeKey: "pull-request:7",
      delivery: "open",
      provenance: "bot",
      nativeState: "opened",
      mergeability: "can_be_merged",
    });
    expect(JSON.parse(result.items[0]?.nativeJson ?? "{}")).toMatchObject({
      merge_status: "can_be_merged",
    });
    expect(result.items[1]).toMatchObject({
      kind: "issue",
      nativeKey: "issue:7",
    });
    expect(result.backfillComplete).toBe(true);
  });

  test("verifies individual merge requests and issues by native key", async () => {
    const adapter = new GitLabSourceAdapter();
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/merge_requests/7")) {
        return Response.json({
          iid: 7,
          title: "Ship work ledger",
          state: "merged",
          merged_at: "2026-07-27T17:00:00.000Z",
          web_url: "https://gitlab.example.com/acme/app/-/merge_requests/7",
          updated_at: "2026-07-27T17:00:00.000Z",
          author: { name: "A. Agent", bot: true },
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    await expect(
      adapter.getItem!({
        baseUrl: "https://gitlab.example.com",
        externalKey: "acme/app",
        kind: "pull-request",
        nativeKey: "pull-request:7",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      status: "found",
      item: { delivery: "merged", nativeKey: "pull-request:7" },
    });
    await expect(
      adapter.getItem!({
        baseUrl: "https://gitlab.example.com",
        externalKey: "acme/app",
        kind: "issue",
        nativeKey: "issue:12",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      status: "unresolved",
    });
  });
});

describe("sources/runtime", () => {
  test("marks source-backed open work unverified when refresh fails", async () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project, source, work } = seedSource(db);
    work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "pull-request",
      nativeKey: "8",
      title: "Last known open pull request",
      delivery: "open",
      provenance: "external",
      nativeState: "opened",
      observedAt: "2026-07-20T00:00:00.000Z",
      syncState: "current",
    });
    const failingAdapter: SourceAdapter = {
      type: "gitlab",
      capabilities: {
        read: true,
        list: true,
        webhooks: false,
        write: false,
        workKinds: ["pull-request"],
      },
      async listActive() {
        throw new Error("provider unavailable");
      },
    };
    const service = new SourceSyncService({
      db,
      registry: new SourceAdapterRegistry([failingAdapter]),
      platformEvents: new PlatformChangeFeed(db),
    });

    expect(await service.syncSource(source.id)).toMatchObject({ errors: 1 });
    expect(work.items.status(project.id)).toMatchObject({
      verifiedOpen: 0,
      staleOpen: 1,
      needsAttention: 1,
    });
    expect(
      work.items
        .listByProject(project.id, { limit: 20, offset: 0 })
        .items.find((item) => item.nativeKey === "8"),
    ).toMatchObject({
      attention: "sync-error",
      syncState: "error",
      lastError: "provider unavailable",
    });
    expect(
      new PlatformChangeFeed(db)
        .list({ afterSequence: 0, projectId: project.id })
        .map((event) => event.type),
    ).toContain("source.sync_failed");
    db.close();
  });

  test("uses manifest source.apiUrl and self-heals a mismatched connection base URL", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({
      name: "forgejo-apiurl",
      repoPath: "/tmp/forgejo-apiurl",
      remoteUrl: "ssh://git@192.168.5.251:2222/detroitpro/heka.git",
      manifestJson: JSON.stringify({
        version: 1,
        project: { name: "forgejo-apiurl", defaultBranch: "main" },
        repository: {
          remote: "origin",
          syncBeforeRun: true,
          requireCleanBase: true,
          submodules: false,
          gitLfs: false,
        },
        source: { apiUrl: "http://192.168.5.251:3001" },
        profiles: { cursor: { adapter: "cursor" } },
        validationProfiles: {
          handoff: { steps: [{ name: "handoff", command: "true" }] },
        },
        agents: {
          noop: {
            description: "noop",
            profile: "cursor",
            promptFile: ".gojo/agents/noop.md",
            validationProfile: "handoff",
          },
        },
      }),
    });
    const work = createWorkRepositories(db);
    const stale = work.connections.create({
      name: "192.168.5.251",
      adapter: "forgejo",
      baseUrl: "https://192.168.5.251",
      capabilities: {
        read: true,
        list: true,
        webhooks: true,
        write: false,
        workKinds: ["pull-request", "issue"],
      },
    });
    work.sources.create({
      projectId: project.id,
      connectionId: stale.id,
      kind: "repository",
      externalKey: "detroitpro/heka",
      displayName: "detroitpro/heka",
    });

    const configured = ensureProjectRepositorySource(db, project.id);
    expect(configured?.connectionId).toBe(stale.id);
    expect(work.connections.findById(stale.id)).toMatchObject({
      baseUrl: "http://192.168.5.251:3001",
    });
    expect(
      work.connections.list().filter((connection) => connection.adapter === "forgejo"),
    ).toHaveLength(1);
    db.close();
  });

  test("consolidates a legacy repository source into its configured source", () => {
    const db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({
      name: "source-runtime",
      repoPath: "/tmp/source-runtime",
      remoteUrl: "https://github.com/acme/app.git",
    });
    db.migrate();
    const work = createWorkRepositories(db);
    const legacy = work.sources.listByProject(project.id)[0]!;
    const connection = work.connections.create({
      name: "github.com",
      adapter: "github",
      baseUrl: "https://api.github.com",
      capabilities: {
        read: true,
        list: true,
        webhooks: true,
        write: false,
        workKinds: ["pull-request", "issue"],
      },
    });
    const configured = work.sources.create({
      projectId: project.id,
      connectionId: connection.id,
      kind: "repository",
      externalKey: "acme/app",
      displayName: "acme/app",
    });
    const item = work.items.upsertExternal({
      projectId: project.id,
      sourceId: legacy.id,
      kind: "pull-request",
      nativeKey: "12",
      title: "Migrated pull request",
      delivery: "open",
      provenance: "gojo-agent",
      nativeState: "open",
      syncState: "pending",
    });

    expect(ensureProjectRepositorySource(db, project.id)?.id).toBe(configured.id);
    expect(work.sources.listByProject(project.id)).toHaveLength(1);
    expect(work.items.findById(item.id)?.sourceId).toBe(configured.id);
    db.migrate();
    expect(work.sources.listByProject(project.id)).toHaveLength(1);
    db.close();
  });

  test("syncs an adapter page into the canonical ledger and updates freshness", async () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project, source, work } = seedSource(db);
    work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "pull-request",
      nativeKey: "8",
      title: "Already merged remotely",
      delivery: "open",
      provenance: "external",
      nativeState: "opened",
      observedAt: "2026-07-20T00:00:00.000Z",
      syncState: "current",
    });
    const runWork = work.items.create({
      projectId: project.id,
      kind: "run",
      title: "Deliver OPS-9",
      provenance: "gojo-agent",
    });
    const orphan = work.items.create({
      projectId: project.id,
      kind: "issue",
      nativeKey: "OPS-9",
      title: "Legacy linked artifact",
      delivery: "open",
      provenance: "gojo-agent",
      nativeState: "investigating",
      webUrl: "https://gitlab.example.com/acme/app/-/issues/OPS-9",
      syncState: "current",
    });
    work.links.create(runWork.id, orphan.id, "delivers");
    const absentOrphan = work.items.create({
      projectId: project.id,
      kind: "issue",
      nativeKey: "OPS-10",
      title: "Closed outside Gojo",
      delivery: "open",
      provenance: "gojo-agent",
      nativeState: "opened",
      webUrl: "https://gitlab.example.com/acme/app/-/issues/OPS-10",
      syncState: "current",
    });
    let observedToken: string | null | undefined;
    const fakeAdapter: SourceAdapter = {
      type: "gitlab",
      capabilities: {
        read: true,
        list: true,
        webhooks: true,
        write: false,
        workKinds: ["issue"],
      },
      async listActive(input) {
        observedToken = input.token;
        return {
          items: [
            {
              kind: "issue",
              nativeKey: "OPS-9",
              title: "Restore service",
              summary: "",
              delivery: "open",
              outcome: "pending",
              provenance: "human",
              labels: ["incident"],
              nativeState: "investigating",
              nativeJson: JSON.stringify({ severity: 1 }),
              webUrl: "https://status.example/incidents/OPS-9",
              observedAt: "2026-07-27T16:10:00.000Z",
            },
          ],
          cursor: "next:1",
          backfillComplete: true,
        };
      },
      async getItem(input) {
        if (input.nativeKey === "8") {
          return {
            status: "found",
            item: {
              kind: "pull-request",
              nativeKey: "8",
              title: "Already merged remotely",
              summary: "",
              delivery: "merged",
              outcome: "pending",
              provenance: "external",
              labels: [],
              nativeState: "merged",
              nativeJson: "{}",
              webUrl: "https://gitlab.example.com/acme/app/-/merge_requests/8",
              observedAt: "2026-07-27T16:11:00.000Z",
            },
          };
        }
        return {
          status: "unresolved",
          detail: `Missing ${input.nativeKey}`,
        };
      },
    };
    const registry = new SourceAdapterRegistry([fakeAdapter]);
    const observedWork: Array<{ nativeKey: string | null; previousLabels: string[] }> = [];
    const service = new SourceSyncService({
      db,
      registry,
      resolveDefaultToken: () => "provider-token",
      onObserved: async ({ workItem, previousLabels }) => {
        observedWork.push({ nativeKey: workItem.nativeKey, previousLabels });
      },
    });

    const summary = await service.syncSource(source.id);

    expect(summary).toMatchObject({ upserted: 1, errors: 0 });
    expect(observedToken).toBe("provider-token");
    expect(observedWork).toEqual([{ nativeKey: "OPS-9", previousLabels: [] }]);
    expect(work.sources.findById(source.id)).toMatchObject({
      syncState: "current",
      lastError: null,
    });
    expect(
      work.items
        .listByProject(project.id, { limit: 20, offset: 0 })
        .items.find((item) => item.nativeKey === "OPS-9"),
    ).toMatchObject({
      nativeKey: "OPS-9",
      nativeState: "investigating",
      syncState: "current",
    });
    expect(
      work.items
        .listByProject(project.id, { limit: 20, offset: 0 })
        .items.find((item) => item.nativeKey === "8"),
    ).toMatchObject({
      attention: "none",
      syncState: "current",
      delivery: "merged",
    });
    const observed = work.items
      .listByProject(project.id, { limit: 20, offset: 0 })
      .items.filter((item) => item.nativeKey === "OPS-9");
    expect(observed).toHaveLength(1);
    expect(work.items.findById(orphan.id)).toBeNull();
    expect(work.links.listByWorkItem(runWork.id)).toContainEqual(
      expect.objectContaining({
        targetWorkItemId: observed[0]?.id,
        type: "delivers",
      }),
    );
    expect(work.items.findById(absentOrphan.id)).toMatchObject({
      attention: "stale",
      syncState: "stale",
    });
    expect(work.items.status(project.id)).toMatchObject({
      verifiedOpen: 1,
      staleOpen: 1,
    });
    db.close();
  });

  test("does not mark absent work stale when the active snapshot is incomplete", async () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project, source, work } = seedSource(db);
    work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "pull-request",
      nativeKey: "pull-request:8",
      title: "Still open somewhere",
      delivery: "open",
      provenance: "external",
      nativeState: "opened",
      syncState: "current",
    });
    const incompleteAdapter: SourceAdapter = {
      type: "gitlab",
      capabilities: {
        read: true,
        list: true,
        webhooks: true,
        write: false,
        workKinds: ["pull-request"],
      },
      async listActive() {
        return { items: [], cursor: "page:2", backfillComplete: false };
      },
    };
    const service = new SourceSyncService({
      db,
      registry: new SourceAdapterRegistry([incompleteAdapter]),
    });

    await service.syncSource(source.id);
    expect(
      work.items
        .listByProject(project.id, { limit: 20, offset: 0 })
        .items.find((item) => item.nativeKey === "pull-request:8"),
    ).toMatchObject({
      attention: "none",
      syncState: "current",
    });
    db.close();
  });

  test("rechecks and resolves source-backed work items for operators", async () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project, source, work } = seedSource(db);
    const stale = work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "issue",
      nativeKey: "issue:3",
      title: "Ghost issue",
      delivery: "open",
      attention: "stale",
      provenance: "external",
      nativeState: "opened",
      syncState: "stale",
      lastError: "No longer present in the source active-work snapshot",
    });
    const adapter: SourceAdapter = {
      type: "gitlab",
      capabilities: {
        read: true,
        list: true,
        webhooks: true,
        write: false,
        workKinds: ["issue"],
      },
      async listActive() {
        return { items: [], cursor: null, backfillComplete: true };
      },
      async getItem() {
        return {
          status: "found",
          item: {
            kind: "issue",
            nativeKey: "issue:3",
            title: "Ghost issue",
            summary: "",
            delivery: "closed",
            outcome: "pending",
            provenance: "external",
            labels: [],
            nativeState: "closed",
            nativeJson: "{}",
            webUrl: "https://gitlab.example.com/acme/app/-/issues/3",
            observedAt: "2026-07-27T18:00:00.000Z",
          },
        };
      },
    };
    const service = new SourceSyncService({
      db,
      registry: new SourceAdapterRegistry([adapter]),
      platformEvents: new PlatformChangeFeed(db),
    });

    const recheck = await service.recheckWorkItem(stale.id);
    expect(recheck).toMatchObject({
      status: "terminal",
      work: { delivery: "closed", attention: "none", syncState: "current" },
    });
    expect(work.items.status(project.id)).toMatchObject({
      needsAttention: 0,
      staleOpen: 0,
    });

    const ghost = work.items.upsertExternal({
      projectId: project.id,
      sourceId: source.id,
      kind: "issue",
      nativeKey: "issue:4",
      title: "Unresolved ghost",
      delivery: "open",
      attention: "stale",
      provenance: "external",
      nativeState: "opened",
      syncState: "stale",
    });
    const unresolvedAdapter: SourceAdapter = {
      ...adapter,
      async getItem() {
        return { status: "unresolved", detail: "not found" };
      },
    };
    const unresolvedService = new SourceSyncService({
      db,
      registry: new SourceAdapterRegistry([unresolvedAdapter]),
      platformEvents: new PlatformChangeFeed(db),
    });
    expect(await unresolvedService.recheckWorkItem(ghost.id)).toMatchObject({
      status: "unresolved",
      work: { attention: "stale" },
    });
    const resolved = unresolvedService.resolveWorkItem(ghost.id, {
      resolvedBy: "ops",
      note: "Closed outside gojo",
    });
    expect(resolved).toMatchObject({
      resolution: "operator",
      attention: "none",
      delivery: "open",
    });
    expect(work.items.status(project.id)).toMatchObject({ needsAttention: 0, staleOpen: 0 });
    db.close();
  });

  test("verifies and deduplicates signed generic work webhook events", async () => {
    const db = Database.open(":memory:");
    db.migrate();
    const { project, source, work } = seedSource(db, "generic-webhook");
    const body = JSON.stringify({
      id: "delivery-1",
      occurredAt: "2026-07-27T16:20:00.000Z",
      item: {
        kind: "deployment",
        nativeKey: "deploy-123",
        title: "Production deployment",
        delivery: "open",
        outcome: "pending",
        provenance: "external",
        nativeState: "running",
        nativeJson: { environment: "production" },
      },
    });
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    const ingestor = new GenericWebhookIngestor({
      db,
      resolveSecret: (name) => (name === "source-webhook" ? "secret" : null),
    });

    expect(await ingestor.ingest(source.id, body, `sha256=${signature}`)).toMatchObject({
      accepted: true,
      duplicate: false,
    });
    expect(await ingestor.ingest(source.id, body, `sha256=${signature}`)).toMatchObject({
      accepted: true,
      duplicate: true,
    });
    expect(work.items.listByProject(project.id, { limit: 20, offset: 0 }).items).toContainEqual(
      expect.objectContaining({
        kind: "deployment",
        nativeKey: "deploy-123",
        nativeState: "running",
      }),
    );
    db.close();
  });
});
