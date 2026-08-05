import { describe, expect, test } from "bun:test";

import type { WorkItem } from "@gojo/contracts/types";

import {
  buildProgressSummary,
  collapseHistoryForOverview,
  formatActivitySummaryLine,
  forgeWorkListUrl,
  formatAvailableWorkLine,
  inventoryAvailableWork,
  isAttentionWork,
  presentAttentionItem,
  presentCompletedWork,
  resolveActivityRange,
  summarizeCompletedWork,
} from "../../../web/src/kernel/project-overview.ts";

function work(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "work-1",
    projectId: "project-1",
    sourceId: null,
    kind: "run",
    nativeKey: "run-1",
    title: "Harden worktree lifecycle",
    summary: "Added remote branch cleanup and retention telemetry.",
    execution: "terminal",
    delivery: "none",
    outcome: "succeeded",
    attention: "none",
    provenance: "gojo-agent",
    actorName: null,
    profileId: null,
    labels: [],
    nativeState: null,
    nativeJson: "{}",
    webUrl: null,
    observedAt: null,
    nextSyncAt: null,
    syncState: "current",
    lastError: null,
    resolution: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    createdAt: "2026-08-04T10:00:00.000Z",
    updatedAt: "2026-08-04T11:00:00.000Z",
    startedAt: "2026-08-04T10:00:00.000Z",
    completedAt: "2026-08-04T11:00:00.000Z",
    agentName: "Repository Maintainer",
    agentLabel: "claude",
    ...overrides,
  };
}

describe("project-overview helpers", () => {
  test("resolveActivityRange defaults to last 24 hours", () => {
    const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as Storage;
    const range = resolveActivityRange("24h", "project-1", { nowMs, storage });
    expect(range.label).toBe("Last 24 hours");
    expect(range.from).toBe("2026-08-03T12:00:00.000Z");
  });

  test("resolveActivityRange uses last check when available", () => {
    const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
    const storage = {
      getItem: () => "2026-08-04T08:00:00.000Z",
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as Storage;
    const range = resolveActivityRange("last-check", "project-1", { nowMs, storage });
    expect(range.label).toBe("Since your last check");
    expect(range.from).toBe("2026-08-04T08:00:00.000Z");
  });

  test("presentCompletedWork emphasizes outcome and agent", () => {
    const presented = presentCompletedWork(
      work({
        deliveredWork: [
          work({
            id: "pr-1",
            kind: "pull-request",
            title: "Cleanup PR",
            delivery: "merged",
            webUrl: "https://github.com/acme/repo/pull/142",
            summary: "",
            agentName: null,
          }),
        ],
      }),
      Date.parse("2026-08-04T11:38:00.000Z"),
    );
    expect(presented.outcomeTitle).toBe("Harden worktree lifecycle");
    expect(presented.description).toContain("remote branch cleanup");
    expect(presented.agentLabel).toContain("Repository Maintainer");
    expect(presented.deliveryRefs.some((ref) => ref.includes("PR #142"))).toBe(true);
    expect(presented.completedRelative).toContain("minute");
  });

  test("summarizeCompletedWork counts merges and runs", () => {
    const metrics = summarizeCompletedWork([
      work(),
      work({
        id: "pr",
        kind: "pull-request",
        delivery: "merged",
        title: "PR",
        summary: "",
        nativeKey: "pr:1",
      }),
    ]);
    expect(metrics.workCompleted).toBe(2);
    expect(metrics.runsCompleted).toBe(1);
    expect(metrics.prsMerged).toBe(1);
    expect(formatActivitySummaryLine(metrics)).toContain("2 work items completed");
  });

  test("collapseHistoryForOverview hides nested deliveries", () => {
    const pr = work({
      id: "pr-1",
      kind: "pull-request",
      title: "PR",
      summary: "",
      delivery: "merged",
      nativeKey: "pr:1",
    });
    const run = work({ deliveredWork: [pr] });
    const top = collapseHistoryForOverview([run, pr]);
    expect(top.map((item) => item.id)).toEqual(["work-1"]);
  });

  test("buildProgressSummary stays outcome-oriented", () => {
    const summary = buildProgressSummary({
      rangeLabel: "Last 24 hours",
      completed: [work()],
      attentionCount: 0,
      activeCount: 0,
      projectEnabled: true,
    });
    expect(summary.derived).toBe(true);
    expect(summary.text).toContain("Harden worktree lifecycle");
    expect(summary.text).toContain("No active work is currently blocked");
  });

  test("presentAttentionItem explains stale work", () => {
    const presented = presentAttentionItem(
      work({
        kind: "issue",
        title: "Stale issue",
        attention: "stale",
        lastError: "No longer present in the source",
        observedAt: "2026-08-03T12:00:00.000Z",
      }),
      Date.parse("2026-08-04T12:00:00.000Z"),
    );
    expect(presented.why).toContain("Stale");
    expect(presented.expectedAction).toContain("Recheck");
    expect(presented.sinceLabel).toMatch(/hour|day/);
  });

  test("open backlog is inventory, not attention", () => {
    const openIssue = work({
      id: "issue-1",
      kind: "issue",
      title: "Backlog issue",
      delivery: "open",
      attention: "none",
      execution: "none",
      outcome: "pending",
      summary: "",
      nativeKey: "issue:1",
    });
    const staleIssue = work({
      id: "issue-2",
      kind: "issue",
      title: "Stale issue",
      delivery: "open",
      attention: "stale",
      execution: "none",
      summary: "",
      nativeKey: "issue:2",
    });
    expect(isAttentionWork(openIssue)).toBe(false);
    expect(isAttentionWork(staleIssue)).toBe(true);
    const inventory = inventoryAvailableWork([openIssue, staleIssue]);
    expect(inventory.openIssues).toBe(1);
    expect(formatAvailableWorkLine(inventory)).toBe("Available to work: 1 open issue");
  });

  test("forgeWorkListUrl builds GitHub issue and PR browsers", () => {
    const repo = "https://github.com/detroitpro/gojo";
    expect(forgeWorkListUrl(repo, "issue", "open")).toBe(`${repo}/issues`);
    expect(forgeWorkListUrl(repo, "issue", "closed")).toContain("is%3Aissue");
    expect(forgeWorkListUrl(repo, "pull-request", "open")).toBe(`${repo}/pulls`);
    expect(forgeWorkListUrl(repo, "pull-request", "merged")).toContain("is%3Amerged");
    expect(forgeWorkListUrl(repo, "pull-request", "closed")).toContain("is%3Aunmerged");
    expect(forgeWorkListUrl("https://gitlab.com/acme/app", "issue", "open")).toContain(
      "/-/issues?state=opened",
    );
  });

});
