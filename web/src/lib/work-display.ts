import type { WorkItem } from "@/types";

export type WorkHistoryHref =
  | { type: "run"; id: string }
  | { type: "external"; url: string };

const KIND_LABELS: Record<string, string> = {
  run: "Run",
  "pull-request": "PR",
  issue: "Issue",
  ticket: "Ticket",
  incident: "Incident",
  deployment: "Deployment",
};

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function workKindLabel(item: Pick<WorkItem, "kind">): string {
  return KIND_LABELS[item.kind] ?? titleCase(item.kind);
}

export function workPrimaryLabel(
  item: Pick<WorkItem, "kind" | "title" | "taskName">,
): string {
  if (item.kind === "run") {
    return item.taskName?.trim() || item.title;
  }
  return item.title;
}

export function workSecondaryLabel(
  item: Pick<WorkItem, "kind" | "title" | "summary" | "taskName">,
): string | null {
  const summary = item.summary?.trim();
  if (!summary) return null;
  const primary = workPrimaryLabel(item);
  if (summary === primary) return null;
  return summary;
}

export function workTaskAgentLabel(
  item: Pick<WorkItem, "kind" | "taskName" | "agentLabel" | "actorName" | "provenance">,
): string {
  const taskName = item.taskName?.trim() || null;
  const agent =
    item.agentLabel?.trim() ||
    item.actorName?.trim() ||
    item.provenance;

  if (item.kind === "run") {
    if (taskName && agent) return `${taskName} · ${agent}`;
    return taskName ?? agent;
  }

  if (taskName) return `via ${taskName}`;
  return agent;
}

export function workResultLabel(
  item: Pick<WorkItem, "resolution" | "delivery" | "outcome">,
): string {
  if (item.resolution === "operator") return "Resolved by operator";
  if (item.delivery !== "none") return titleCase(item.delivery);
  return titleCase(item.outcome);
}

export function workHistoryHref(
  item: Pick<WorkItem, "kind" | "nativeKey" | "webUrl">,
): WorkHistoryHref | null {
  if (item.kind === "run" && item.nativeKey) {
    return { type: "run", id: item.nativeKey };
  }
  if (item.webUrl) {
    return { type: "external", url: item.webUrl };
  }
  return null;
}

export type HistoryTimelineRow = {
  item: WorkItem;
  nested: boolean;
  parentId: string | null;
};

/**
 * Collapse a run and its `deliveredWork` PRs into parent + nested child rows.
 * Standalone forge rows remain top-level when their delivering run is not in the page.
 */
export function collapseHistoryTimeline(items: WorkItem[]): HistoryTimelineRow[] {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const nestedIds = new Set<string>();
  for (const item of items) {
    for (const delivery of item.deliveredWork ?? []) {
      nestedIds.add(delivery.id);
    }
  }

  const rows: HistoryTimelineRow[] = [];
  for (const item of items) {
    if (nestedIds.has(item.id)) continue;
    rows.push({ item, nested: false, parentId: null });
    for (const delivery of item.deliveredWork ?? []) {
      rows.push({
        item: byId.get(delivery.id) ?? delivery,
        nested: true,
        parentId: item.id,
      });
    }
  }
  return rows;
}
