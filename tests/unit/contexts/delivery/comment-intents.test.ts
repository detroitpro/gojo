import {
  createApprovalRepository,
  createControlIntentRepository,
} from "@/contexts/delivery/contract";
import { afterEach, describe, expect, test } from "bun:test";

import { CommentIntentService } from "@/contexts/delivery/application/comment-intents";
import { ApprovalService } from "@/contexts/delivery/application/approval-service";
import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from "@/infrastructure/persistence";
import { createWorkRepositories } from "@/contexts/work/contract";
import type { SourceAdapter } from "@/contexts/work/sources";

describe("forge comment control intents", () => {
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  test("applies trusted merge commands once and advances the cursor", async () => {
    db = Database.open(":memory:");
    db.migrate();
    const repos = createRepositories(db);
    const work = createWorkRepositories(db);
    const project = repos.projects.create({
      name: "remote-control",
      repoPath: "/tmp/remote-control",
    });
    const connection = work.connections.create({
      name: "Forgejo",
      adapter: "forgejo",
      baseUrl: "https://forge.example",
      configJson: JSON.stringify({ controlTrustedActors: ["detroitpro"] }),
      capabilities: {
        read: true,
        list: true,
        webhooks: false,
        write: true,
        workKinds: ["pull-request", "issue"],
      },
    });
    const source = work.sources.create({
      projectId: project.id,
      connectionId: connection.id,
      kind: "repository",
      externalKey: "acme/app",
      displayName: "acme/app",
    });
    const pullRequest = work.items.create({
      projectId: project.id,
      sourceId: source.id,
      kind: "pull-request",
      nativeKey: "17",
      title: "Ship remotely",
      delivery: "open",
      webUrl: "https://forge.example/acme/app/pulls/17",
    });
    const merges: string[] = [];
    const approvals = new ApprovalService({
      approvals: createApprovalRepository(db!),
      intents: createControlIntentRepository(db!),
      merge: async (approval) => {
        merges.push(approval.id);
        return { status: "merged" };
      },
    });
    const approval = approvals.create({
      projectId: project.id,
      subjectType: "pull-request",
      subjectId: pullRequest.id,
      workItemId: pullRequest.id,
      autonomy: "manual",
      state: "awaiting-human",
      checksState: "success",
      reviewVerdict: "pass",
    });
    const mutations: string[] = [];
    const adapter: SourceAdapter = {
      type: "forgejo",
      capabilities: connection.capabilities,
      async listActive() {
        return { items: [], cursor: null, backfillComplete: true };
      },
      async listComments(input) {
        if (input.kind === "issue") {
          return [
            {
              id: "93",
              body: "/gojo claim issue-implement",
              actor: "detroitpro",
              createdAt: "2026-07-30T00:02:00.000Z",
            },
          ];
        }
        return [
          {
            id: "91",
            body: "/gojo merge ship it",
            actor: "detroitpro",
            createdAt: "2026-07-30T00:00:00.000Z",
          },
          {
            id: "92",
            body: "/gojo approve",
            actor: "stranger",
            createdAt: "2026-07-30T00:01:00.000Z",
          },
        ];
      },
      async setLabels(input) {
        mutations.push(...(input.add ?? []));
        return [...(input.add ?? [])];
      },
      async comment(input) {
        mutations.push(input.body);
        return {
          id: "reply",
          body: input.body,
          actor: "gojo",
          createdAt: "2026-07-30T00:03:00.000Z",
        };
      },
    };
    const service = new CommentIntentService({
      db,
      approvals,
      claim: async (_workItem, agentName) =>
        agentName === "issue-implement" ? "run-claim" : null,
    });

    expect(
      await service.observe({
        source,
        connection,
        adapter,
        token: "secret",
        workItem: pullRequest,
      }),
    ).toBe(1);
    expect(merges).toEqual([approval.id]);

    expect(
      await service.observe({
        source,
        connection,
        adapter,
        token: "secret",
        workItem: pullRequest,
      }),
    ).toBe(0);
    expect(merges).toHaveLength(1);

    const issue = work.items.create({
      projectId: project.id,
      sourceId: source.id,
      kind: "issue",
      nativeKey: "18",
      title: "Claim remotely",
      delivery: "open",
    });
    expect(
      await service.observe({
        source,
        connection,
        adapter,
        token: "secret",
        workItem: issue,
      }),
    ).toBe(1);
    expect(mutations).toContain("gojo:in-progress");
    expect(mutations.some((value) => value.includes("run-claim"))).toBe(true);
  });
});
