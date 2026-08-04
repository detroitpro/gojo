import { describe, expect, test } from "bun:test";

import { createApprovalChangeHandler } from "@/contexts/delivery/subscribers/approval-change";
import type { UserService } from "@/contexts/access/infrastructure/auth/users";
import type { PlatformChangeFeed } from "@/platform/events/platform-change-feed";
import type { RunEventBus } from "@/contexts/execution/infrastructure/events";
import type { WorkRepositories } from "@/contexts/work/contract";
import type { Approval } from "@shared/approvals";

type PlatformEvent = {
  projectId: string;
  type: string;
  entityKind: string;
  entityId: string;
  topics: string[];
  data?: unknown;
};

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "approval-1",
    projectId: "proj-1",
    runId: "run-1",
    workItemId: "work-1",
    subjectType: "pull-request",
    subjectId: "subject-1",
    reason: "",
    state: "pending-review",
    autonomy: "manual",
    checksState: null,
    reviewVerdict: null,
    evidence: {},
    decidedBy: null,
    decidedVia: null,
    note: null,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Approval;
}

function makeDeps(opts: {
  admin?: { id: string; username?: string } | null;
  workItem?: { webUrl?: string | null } | null;
  apiBaseUrl?: string | null;
} = {}) {
  const platformEvents: PlatformEvent[] = [];
  const runEvents: Array<{ type: string; runId: string; data: Record<string, unknown> }> = [];
  const createdTokens: Array<{
    userId: string;
    name: string;
    scopes: string[] | undefined;
  }> = [];

  const platformFeed = {
    append(event: PlatformEvent) {
      platformEvents.push(event);
      return event;
    },
  } as unknown as PlatformChangeFeed;

  const eventBus = {
    emit(event: { type: string; runId: string; data: Record<string, unknown> }) {
      runEvents.push(event);
    },
  } as unknown as RunEventBus;

  const users = {
    findFirstAdmin() {
      return opts.admin === undefined
        ? { id: "admin-1", username: "admin" }
        : opts.admin;
    },
    createApiTokenForUser(userId: string, name: string, options?: { scopes?: string[] }) {
      createdTokens.push({ userId, name, scopes: options?.scopes });
      return {
        token: `token-for-${name}`,
        record: {
          id: `tok-${createdTokens.length}`,
          userId,
          tokenHash: "hash",
          name,
          scopesJson: JSON.stringify(options?.scopes ?? []),
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: null,
        },
      };
    },
  } as unknown as UserService;

  const work = {
    items: {
      findById(_id: string) {
        return opts.workItem === undefined
          ? { webUrl: "https://example.com/pr/42" }
          : opts.workItem;
      },
    },
  } as unknown as WorkRepositories;

  return {
    handler: createApprovalChangeHandler({
      users,
      work,
      platformEvents: platformFeed,
      eventBus,
      apiBaseUrl:
        "apiBaseUrl" in opts ? opts.apiBaseUrl ?? null : "https://gojo.example.com/",
    }),
    platformEvents,
    runEvents,
    createdTokens,
  };
}

describe("delivery approval-change subscriber", () => {
  test("emits approval.updated platform event on every change", () => {
    const { handler, platformEvents } = makeDeps();
    handler(makeApproval({ state: "pending-review" }));
    expect(platformEvents).toHaveLength(1);
    const evt = platformEvents[0]!;
    expect(evt.type).toBe("approval.updated");
    expect(evt.entityKind).toBe("approval");
    expect(evt.entityId).toBe("approval-1");
    expect(evt.projectId).toBe("proj-1");
    expect(evt.topics).toEqual(
      expect.arrayContaining(["dashboard", "work", "runs"]),
    );
  });

  test("does not emit run event when state is not awaiting-human", () => {
    const { handler, runEvents, createdTokens } = makeDeps();
    handler(makeApproval({ state: "pending-review" }));
    expect(runEvents).toHaveLength(0);
    expect(createdTokens).toHaveLength(0);
  });

  test("does not emit run event when runId is missing", () => {
    const { handler, runEvents } = makeDeps();
    handler(makeApproval({ state: "awaiting-human", runId: null }));
    expect(runEvents).toHaveLength(0);
  });

  test("emits run.awaiting_approval with signed approve link", () => {
    const { handler, runEvents, createdTokens } = makeDeps();
    handler(makeApproval({ state: "awaiting-human" }));
    expect(runEvents).toHaveLength(1);
    const evt = runEvents[0]!;
    expect(evt.type).toBe("run.awaiting_approval");
    expect(evt.runId).toBe("run-1");
    expect(evt.data["approvalId"]).toBe("approval-1");
    expect(evt.data["prUrl"]).toBe("https://example.com/pr/42");
    expect(String(evt.data["approveUrl"])).toContain(
      "/api/v1/approvals/approval-1/approve-link?token=",
    );
    expect(createdTokens).toHaveLength(1);
    expect(createdTokens[0]?.scopes).toEqual(["control:approve:approval-1"]);
  });

  test("omits approve link when no admin exists", () => {
    const { handler, runEvents, createdTokens } = makeDeps({ admin: null });
    handler(makeApproval({ state: "awaiting-human" }));
    expect(runEvents).toHaveLength(1);
    expect(runEvents[0]?.data["approveUrl"]).toBeNull();
    expect(createdTokens).toHaveLength(0);
  });

  test("omits approve link when apiBaseUrl is not set", () => {
    const { handler, runEvents, createdTokens } = makeDeps({ apiBaseUrl: null });
    handler(makeApproval({ state: "awaiting-human" }));
    expect(runEvents).toHaveLength(1);
    expect(runEvents[0]?.data["approveUrl"]).toBeNull();
    expect(createdTokens).toHaveLength(0);
  });
});
