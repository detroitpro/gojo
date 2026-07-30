import { describe, expect, test } from "bun:test";

import {
  attentionMenuItems,
  attentionPrimaryAction,
  attentionReasonLabel,
  workExternalHref,
} from "../../../web/src/lib/work-attention";
import type { WorkItem } from "../../../web/src/types";

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "work-1",
    projectId: "project-1",
    sourceId: "source-1",
    kind: "issue",
    nativeKey: "issue:1",
    title: "Ghost issue",
    summary: "",
    execution: "none",
    delivery: "open",
    outcome: "pending",
    attention: "stale",
    provenance: "external",
    actorName: null,
    profileId: null,
    labels: [],
    nativeState: "opened",
    webUrl: "https://gitlab.example.com/acme/app/-/issues/1",
    observedAt: "2026-07-27T16:00:00.000Z",
    nextSyncAt: null,
    syncState: "stale",
    lastError: "No longer present in the source active-work snapshot",
    resolution: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    createdAt: "2026-07-27T16:00:00.000Z",
    updatedAt: "2026-07-27T16:00:00.000Z",
    startedAt: null,
    completedAt: null,
    agentName: null,
    agentLabel: null,
    ...overrides,
  };
}

describe("web/work-attention", () => {
  test("maps reason-specific primary actions", () => {
    expect(
      attentionPrimaryAction(
        item({
          attention: "approval",
          kind: "run",
          nativeKey: "run-1",
          sourceId: null,
          webUrl: null,
        }),
      ),
    ).toMatchObject({ id: "review-run", kind: "route" });
    expect(
      attentionPrimaryAction(
        item({
          attention: "blocked",
          kind: "run",
          nativeKey: "run-2",
          sourceId: null,
          webUrl: null,
        }),
      ),
    ).toMatchObject({ id: "open-run", kind: "route" });
    expect(attentionPrimaryAction(item({ attention: "stale" }))).toMatchObject({
      id: "recheck-item",
      kind: "action",
    });
    expect(attentionPrimaryAction(item({ attention: "sync-error" }))).toMatchObject({
      id: "retry-source",
      kind: "action",
    });
  });

  test("exposes open/recheck/resolve menu actions for stale work", () => {
    const menu = attentionMenuItems(item());
    expect(menu.map((entry) => entry.id)).toEqual([
      "open-source",
      "recheck-item",
      "resolve",
    ]);
    expect(workExternalHref(item({ webUrl: null }), "https://gitlab.example.com/acme/app")).toBe(
      "https://gitlab.example.com/acme/app",
    );
    expect(attentionReasonLabel("stale")).toBe("Stale observation");
  });
});
