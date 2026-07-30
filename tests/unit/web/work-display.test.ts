import { describe, expect, test } from "bun:test";

import {
  collapseHistoryTimeline,
  workHistoryHref,
  workKindLabel,
  workPrimaryLabel,
  workResultLabel,
  workSecondaryLabel,
  workAgentProfileLabel,
} from "../../../web/src/lib/work-display";
import type { WorkItem } from "../../../web/src/types";

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "work-1",
    projectId: "project-1",
    sourceId: null,
    kind: "run",
    nativeKey: "run-1",
    title: "activity-digest",
    summary: "Done",
    execution: "terminal",
    delivery: "none",
    outcome: "succeeded",
    attention: "none",
    provenance: "gojo-agent",
    actorName: "cursor",
    profileId: "profile-1",
    labels: [],
    nativeState: "succeeded",
    webUrl: null,
    observedAt: null,
    nextSyncAt: null,
    syncState: "current",
    lastError: null,
    resolution: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    createdAt: "2026-07-27T16:00:00.000Z",
    updatedAt: "2026-07-27T16:00:00.000Z",
    startedAt: null,
    completedAt: "2026-07-27T16:05:00.000Z",
    agentName: "activity-digest",
    agentLabel: "cursor",
    ...overrides,
  };
}

describe("web/work-display", () => {
  test("labels run rows with durable agent identity and focus subtitle", () => {
    const run = item();
    expect(workKindLabel(run)).toBe("Run");
    expect(workPrimaryLabel(run)).toBe("activity-digest");
    expect(workSecondaryLabel(run)).toBe("Done");
    expect(workAgentProfileLabel(run)).toBe("activity-digest · cursor");
    expect(workResultLabel(run)).toBe("Succeeded");
    expect(workHistoryHref(run)).toEqual({ type: "run", id: "run-1" });
  });

  test("labels delivered PR rows with via agent attribution", () => {
    const pr = item({
      kind: "pull-request",
      nativeKey: "12",
      title: "Fix scheduler storage",
      summary: "",
      delivery: "merged",
      outcome: "succeeded",
      provenance: "gojo-agent",
      actorName: null,
      sourceId: "source-1",
      webUrl: "https://github.com/acme/app/pull/12",
      agentName: "maintain-merge",
      agentLabel: "cursor",
    });
    expect(workKindLabel(pr)).toBe("PR");
    expect(workPrimaryLabel(pr)).toBe("Fix scheduler storage");
    expect(workSecondaryLabel(pr)).toBeNull();
    expect(workAgentProfileLabel(pr)).toBe("via maintain-merge");
    expect(workResultLabel(pr)).toBe("Merged");
    expect(workHistoryHref(pr)).toEqual({
      type: "external",
      url: "https://github.com/acme/app/pull/12",
    });
  });

  test("humanizes operator resolution and falls back without agent/profile", () => {
    const resolved = item({
      kind: "issue",
      title: "Ghost issue",
      summary: "",
      delivery: "open",
      outcome: "pending",
      resolution: "operator",
      provenance: "human",
      actorName: "alice",
      agentName: null,
      agentLabel: "alice",
      nativeKey: null,
      webUrl: null,
    });
    expect(workKindLabel(resolved)).toBe("Issue");
    expect(workAgentProfileLabel(resolved)).toBe("alice");
    expect(workResultLabel(resolved)).toBe("Resolved by operator");
    expect(workHistoryHref(resolved)).toBeNull();
  });

  test("collapses delivered PRs under their run and keeps orphan PRs top-level", () => {
    const pr = item({
      id: "pr-1",
      kind: "pull-request",
      title: "Fix scheduler storage",
      summary: "",
      delivery: "merged",
      agentName: "maintain-merge",
      agentLabel: "cursor",
      nativeKey: "12",
      webUrl: "https://github.com/acme/app/pull/12",
    });
    const run = item({
      id: "run-1",
      title: "maintain-merge",
      agentName: "maintain-merge",
      deliveredWork: [pr],
    });
    const orphan = item({
      id: "pr-orphan",
      kind: "pull-request",
      title: "Human hotfix",
      summary: "",
      delivery: "merged",
      agentName: null,
      agentLabel: "human",
      provenance: "human",
      nativeKey: "99",
    });

    expect(collapseHistoryTimeline([pr, run, orphan])).toEqual([
      { item: run, nested: false, parentId: null },
      { item: pr, nested: true, parentId: "run-1" },
      { item: orphan, nested: false, parentId: null },
    ]);
  });
});
