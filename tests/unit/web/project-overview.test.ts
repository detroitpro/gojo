import { describe, expect, test } from "bun:test";

import type { WorkItem } from "@gojo/contracts/types";

import {
  RECENT_CHANGES_LIMIT,
  buildProgressSummary,
  collapseHistoryForOverview,
  formatActivitySummaryLine,
  formatClockTime,
  formatFeedCountsLine,
  forgeWorkListUrl,
  formatAvailableWorkLine,
  groupChangesByDay,
  inventoryAvailableWork,
  isAttentionWork,
  presentAttentionItem,
  presentCompletedWork,
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
  test("RECENT_CHANGES_LIMIT is 25", () => {
    expect(RECENT_CHANGES_LIMIT).toBe(25);
  });

  test("presentCompletedWork emphasizes outcome, agent, and PR ref", () => {
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
    expect(presented.prRef).toEqual({
      label: "#142",
      url: "https://github.com/acme/repo/pull/142",
    });
    expect(presented.kindLabel).toBe("Run");
    expect(presented.resultItem).toEqual({
      resolution: null,
      delivery: "none",
      outcome: "succeeded",
    });
    expect(presented.clockTime).toMatch(/^\d{2}:\d{2}$/);
    expect(presented.completedRelative).toContain("minute");
  });

  test("formatClockTime returns locale HH:MM", () => {
    expect(formatClockTime("2026-08-04T15:07:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
    expect(formatClockTime(null)).toBe("—");
    expect(formatClockTime("not-a-date")).toBe("—");
  });

  test("groupChangesByDay labels Today, Yesterday, and dated groups", () => {
    const nowMs = Date.parse("2026-08-04T18:00:00.000Z");
    const today = presentCompletedWork(
      work({ id: "today", completedAt: "2026-08-04T16:00:00.000Z" }),
      nowMs,
    );
    const yesterday = presentCompletedWork(
      work({ id: "yesterday", completedAt: "2026-08-03T16:00:00.000Z" }),
      nowMs,
    );
    const older = presentCompletedWork(
      work({ id: "older", completedAt: "2026-08-01T16:00:00.000Z" }),
      nowMs,
    );
    const groups = groupChangesByDay([today, yesterday, older], nowMs);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", expect.stringMatching(/Aug/)]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["today"]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(["yesterday"]);
    expect(groups[2]!.items.map((i) => i.id)).toEqual(["older"]);
  });

  test("groupChangesByDay preserves input order within and across days", () => {
    const nowMs = Date.parse("2026-08-04T18:00:00.000Z");
    const a = presentCompletedWork(
      work({ id: "a", completedAt: "2026-08-04T17:00:00.000Z" }),
      nowMs,
    );
    const b = presentCompletedWork(
      work({ id: "b", completedAt: "2026-08-04T15:00:00.000Z" }),
      nowMs,
    );
    const groups = groupChangesByDay([a, b], nowMs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["a", "b"]);
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
    expect(formatFeedCountsLine(metrics)).toBe("2 changes · 1 merged · 1 run");
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

  test("buildProgressSummary stays outcome-oriented without a time window", () => {
    const summary = buildProgressSummary({
      completed: [work()],
      attentionCount: 0,
      activeCount: 0,
      projectEnabled: true,
    });
    expect(summary.derived).toBe(true);
    expect(summary.text).toContain("Recently");
    expect(summary.text).toContain("Harden worktree lifecycle");
    expect(summary.text).toContain("No active work is currently blocked");
  });

  test("buildProgressSummary reports empty feed", () => {
    const summary = buildProgressSummary({
      completed: [],
      attentionCount: 1,
      activeCount: 0,
      projectEnabled: true,
    });
    expect(summary.text).toContain("No completed changes yet");
    expect(summary.text).toContain("1 item still needs attention");
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
