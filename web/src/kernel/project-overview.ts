import type { WorkItem } from "@gojo/contracts/types";

import { attentionReasonLabel } from "./work-attention";
import {
  collapseHistoryTimeline,
  workAgentProfileLabel,
  workKindLabel,
  workPrimaryLabel,
  workResultLabel,
  workSecondaryLabel,
} from "./work-display";

/** Newest completed changes shown on the project overview feed. */
export const RECENT_CHANGES_LIMIT = 25;

export type WorkResultSlice = Pick<WorkItem, "resolution" | "delivery" | "outcome">;

export type PrRef = {
  label: string;
  url: string | null;
};

export function formatRelativeTime(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const deltaSec = Math.round((ms - nowMs) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return rtf.format(deltaSec, "second");
  if (abs < 3600) return rtf.format(Math.round(deltaSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(deltaSec / 3600), "hour");
  if (abs < 86400 * 14) return rtf.format(Math.round(deltaSec / 86400), "day");
  return new Date(ms).toLocaleString();
}

export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function durationLabel(fromIso: string | null | undefined, nowMs = Date.now()): string {
  if (!fromIso) return "unknown duration";
  const ms = Date.parse(fromIso);
  if (!Number.isFinite(ms)) return "unknown duration";
  const minutes = Math.max(0, Math.round((nowMs - ms) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function extractPrRef(item: WorkItem): PrRef | null {
  if (item.kind === "pull-request" && item.webUrl) {
    const m = /pull\/(\d+)/i.exec(item.webUrl) ?? /merge_requests\/(\d+)/i.exec(item.webUrl);
    if (m) return { label: `#${m[1]}`, url: item.webUrl };
    return { label: "PR", url: item.webUrl };
  }
  for (const d of item.deliveredWork ?? []) {
    if (!d.webUrl) continue;
    const m = /pull\/(\d+)/i.exec(d.webUrl) ?? /merge_requests\/(\d+)/i.exec(d.webUrl);
    if (m) return { label: `#${m[1]}`, url: d.webUrl };
    if (d.kind === "pull-request") return { label: "PR", url: d.webUrl };
  }
  return null;
}

export type CompletedWorkPresentation = {
  id: string;
  outcomeTitle: string;
  description: string | null;
  statusLabel: string;
  agentLabel: string;
  completedAt: string | null;
  completedRelative: string;
  clockTime: string;
  runId: string | null;
  externalUrl: string | null;
  prRef: PrRef | null;
  followUp: string | null;
  kind: string;
  kindLabel: string;
  resultItem: WorkResultSlice;
};

export function presentCompletedWork(
  item: WorkItem,
  nowMs = Date.now(),
): CompletedWorkPresentation {
  const secondary = workSecondaryLabel(item);

  let followUp: string | null = null;
  if (item.attention !== "none" && item.resolution == null) {
    followUp = attentionReasonLabel(item.attention);
  } else if (item.lastError) {
    followUp = item.lastError;
  }

  const completedAt = item.resolvedAt ?? item.completedAt ?? item.updatedAt;

  // Prefer an outcome-oriented headline. Run rows often store the agent name as
  // title — promote the summary lead when it carries the real outcome.
  const rawTitle = item.title?.trim() || workPrimaryLabel(item);
  const summaryLead = item.summary?.trim()
    ? truncatePlain(item.summary.trim().split(/(?<=[.!?])\s+/)[0] ?? item.summary, 120)
    : null;
  const titleLooksLikeAgent =
    item.kind === "run" &&
    Boolean(item.agentName) &&
    rawTitle.toLowerCase() === item.agentName!.trim().toLowerCase();
  const outcomeTitle =
    titleLooksLikeAgent && summaryLead && summaryLead !== rawTitle ? summaryLead : rawTitle;
  const description =
    secondary && secondary !== outcomeTitle
      ? truncatePlain(secondary, 220)
      : item.summary?.trim() && item.summary.trim() !== outcomeTitle
        ? truncatePlain(item.summary.trim(), 220)
        : null;

  return {
    id: item.id,
    outcomeTitle,
    description,
    statusLabel: workResultLabel(item),
    agentLabel: workAgentProfileLabel(item),
    completedAt,
    completedRelative: formatRelativeTime(completedAt, nowMs),
    clockTime: formatClockTime(completedAt),
    runId: item.kind === "run" && item.nativeKey ? item.nativeKey : null,
    externalUrl: item.webUrl,
    prRef: extractPrRef(item),
    followUp,
    kind: item.kind,
    kindLabel: workKindLabel(item),
    resultItem: {
      resolution: item.resolution,
      delivery: item.delivery,
      outcome: item.outcome,
    },
  };
}

export type ChangeDayGroup = {
  key: string;
  label: string;
  items: CompletedWorkPresentation[];
};

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayGroupLabel(ms: number, nowMs: number): string {
  const today = startOfLocalDay(nowMs);
  const day = startOfLocalDay(ms);
  const deltaDays = Math.round((today - day) / 86_400_000);
  if (deltaDays === 0) return "Today";
  if (deltaDays === 1) return "Yesterday";
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Group presented changes by local calendar day, preserving input order. */
export function groupChangesByDay(
  items: CompletedWorkPresentation[],
  nowMs = Date.now(),
): ChangeDayGroup[] {
  const groups: ChangeDayGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const ms = item.completedAt ? Date.parse(item.completedAt) : Number.NaN;
    const key = Number.isFinite(ms) ? dayKey(ms) : "unknown";
    const label = Number.isFinite(ms) ? dayGroupLabel(ms, nowMs) : "Unknown";
    const existing = indexByKey.get(key);
    if (existing != null) {
      groups[existing]!.items.push(item);
      continue;
    }
    indexByKey.set(key, groups.length);
    groups.push({ key, label, items: [item] });
  }

  return groups;
}

export function formatFeedCountsLine(metrics: ActivitySummaryMetrics): string {
  const parts = [
    `${metrics.workCompleted} change${metrics.workCompleted === 1 ? "" : "s"}`,
  ];
  if (metrics.prsMerged > 0) {
    parts.push(`${metrics.prsMerged} merged`);
  }
  if (metrics.runsCompleted > 0) {
    parts.push(`${metrics.runsCompleted} run${metrics.runsCompleted === 1 ? "" : "s"}`);
  }
  if (metrics.openDeliveries > 0) {
    parts.push(`${metrics.openDeliveries} open`);
  }
  return parts.join(" · ");
}

export type ActivitySummaryMetrics = {
  workCompleted: number;
  prsMerged: number;
  runsCompleted: number;
  openDeliveries: number;
};

export function summarizeCompletedWork(items: WorkItem[]): ActivitySummaryMetrics {
  let prsMerged = 0;
  let runsCompleted = 0;
  let openDeliveries = 0;

  for (const item of items) {
    if (item.kind === "run" && (item.outcome === "succeeded" || item.execution === "terminal")) {
      runsCompleted += 1;
    }
    if (item.kind === "pull-request" && item.delivery === "merged") {
      prsMerged += 1;
    }
    for (const d of item.deliveredWork ?? []) {
      if (d.delivery === "merged") prsMerged += 1;
      if (d.delivery === "open" || d.delivery === "review" || d.delivery === "draft") {
        openDeliveries += 1;
      }
    }
    if (
      item.kind === "pull-request" &&
      (item.delivery === "open" || item.delivery === "review" || item.delivery === "draft")
    ) {
      openDeliveries += 1;
    }
  }

  return {
    workCompleted: items.length,
    prsMerged,
    runsCompleted,
    openDeliveries,
  };
}

export function formatActivitySummaryLine(metrics: ActivitySummaryMetrics): string {
  const parts = [`${metrics.workCompleted} work item${metrics.workCompleted === 1 ? "" : "s"} completed`];
  if (metrics.prsMerged > 0) {
    parts.push(`${metrics.prsMerged} PR${metrics.prsMerged === 1 ? "" : "s"} merged`);
  }
  if (metrics.runsCompleted > 0) {
    parts.push(`${metrics.runsCompleted} successful run${metrics.runsCompleted === 1 ? "" : "s"}`);
  }
  if (metrics.openDeliveries > 0) {
    parts.push(`${metrics.openDeliveries} delivery item${metrics.openDeliveries === 1 ? "" : "s"} still open`);
  }
  return parts.join(" · ");
}

export function buildProgressSummary(input: {
  completed: WorkItem[];
  attentionCount: number;
  activeCount: number;
  projectEnabled: boolean;
}): { text: string; derived: true } {
  const { completed, attentionCount, activeCount, projectEnabled } = input;

  if (!projectEnabled) {
    return {
      derived: true,
      text: `The project is disabled. ${completed.length} recent work item${completed.length === 1 ? " was" : "s were"} recorded, but new scheduled and API runs are blocked until the project is enabled.`,
    };
  }

  if (completed.length === 0) {
    const attention =
      attentionCount > 0
        ? ` ${attentionCount} item${attentionCount === 1 ? "" : "s"} still need${attentionCount === 1 ? "s" : ""} attention.`
        : " No items currently need attention.";
    const active =
      activeCount > 0
        ? ` ${activeCount} work item${activeCount === 1 ? " is" : "s are"} in progress.`
        : " No work is currently active.";
    return {
      derived: true,
      text: `No completed changes yet.${attention}${active}`,
    };
  }

  const titles = completed
    .slice(0, 3)
    .map((item) => item.title?.trim() || workPrimaryLabel(item))
    .filter(Boolean);
  const more = completed.length > titles.length ? ` and ${completed.length - titles.length} more` : "";
  const outcomeList =
    titles.length === 1
      ? titles[0]
      : titles.length === 2
        ? `${titles[0]} and ${titles[1]}`
        : `${titles.slice(0, -1).join(", ")}, and ${titles[titles.length - 1]}`;

  const metrics = summarizeCompletedWork(completed);
  const deliveryBits: string[] = [];
  if (metrics.prsMerged > 0) {
    deliveryBits.push(
      `${metrics.prsMerged} pull request${metrics.prsMerged === 1 ? " was" : "s were"} merged`,
    );
  }
  if (metrics.openDeliveries > 0) {
    deliveryBits.push(
      `${metrics.openDeliveries} change${metrics.openDeliveries === 1 ? " is" : "s are"} ready for review or still open`,
    );
  }

  const blocked =
    attentionCount > 0
      ? `${attentionCount} item${attentionCount === 1 ? " needs" : "s need"} attention.`
      : "No active work is currently blocked.";
  const active =
    activeCount > 0
      ? ` ${activeCount} work item${activeCount === 1 ? " is" : "s are"} in progress.`
      : "";

  const deliverySentence = deliveryBits.length > 0 ? ` ${deliveryBits.join(", and ")}.` : "";

  return {
    derived: true,
    text: `Recently, the team completed work on ${outcomeList}${more}.${deliverySentence} ${blocked}${active}`,
  };
}

export type AttentionPresentation = {
  id: string;
  title: string;
  why: string;
  sinceLabel: string;
  expectedAction: string;
  item: WorkItem;
};

function truncatePlain(text: string, max = 180): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

export function presentAttentionItem(item: WorkItem, nowMs = Date.now()): AttentionPresentation {
  const sinceIso = item.observedAt ?? item.updatedAt;
  const reason = attentionReasonLabel(item.attention);

  const whyParts = [reason];
  if (item.lastError) {
    whyParts.push(truncatePlain(item.lastError, 160));
  } else if (item.summary) {
    whyParts.push(truncatePlain(item.summary, 160));
  }

  let expectedAction = "Review this item";
  if (item.attention === "approval") expectedAction = "Review and approve or reject";
  else if (item.attention === "blocked") expectedAction = "Investigate the blocker";
  else if (item.attention === "stale") expectedAction = "Recheck source state or resolve";
  else if (item.attention === "sync-error") expectedAction = "Retry source sync";

  return {
    id: item.id,
    title: item.title,
    why: whyParts.join(". "),
    sinceLabel: `For ${durationLabel(sinceIso, nowMs)}`,
    expectedAction,
    item,
  };
}

/** Top-level completed outcomes (runs with nested PRs collapsed into one row). */
export function collapseHistoryForOverview(items: WorkItem[]): WorkItem[] {
  return collapseHistoryTimeline(items)
    .filter((row) => !row.nested)
    .map((row) => row.item);
}

export function isActiveWork(item: WorkItem): boolean {
  return item.execution !== "none" && item.execution !== "terminal";
}

/**
 * Operator exceptions that deserve the morning "Needs your attention" list.
 * Open backlog (issues/PRs with attention=none) is inventory, not attention.
 */
export function isAttentionWork(item: WorkItem): boolean {
  return item.attention !== "none" && item.resolution == null;
}

export type AvailableWorkInventory = {
  openIssues: number;
  openPullRequests: number;
};

/**
 * Open source work that is not actively executing and does not already carry an
 * attention reason — useful as backlog inventory, not as critical alerts.
 */
export function inventoryAvailableWork(items: WorkItem[]): AvailableWorkInventory {
  let openIssues = 0;
  let openPullRequests = 0;
  for (const item of items) {
    if (item.resolution != null) continue;
    if (item.attention !== "none") continue;
    if (item.delivery !== "open" && item.delivery !== "draft" && item.delivery !== "review") {
      continue;
    }
    if (item.execution !== "none" && item.execution !== "terminal") continue;
    if (item.kind === "issue") openIssues += 1;
    else if (item.kind === "pull-request") openPullRequests += 1;
  }
  return { openIssues, openPullRequests };
}

export function formatAvailableWorkLine(inventory: AvailableWorkInventory): string | null {
  const parts: string[] = [];
  if (inventory.openIssues > 0) {
    parts.push(
      `${inventory.openIssues} open issue${inventory.openIssues === 1 ? "" : "s"}`,
    );
  }
  if (inventory.openPullRequests > 0) {
    parts.push(
      `${inventory.openPullRequests} open pull request${inventory.openPullRequests === 1 ? "" : "s"}`,
    );
  }
  if (parts.length === 0) return null;
  return `Available to work: ${parts.join(" · ")}`;
}

/** Normalize clone/remote URLs to a browsable repository root. */
export function repositoryBrowseUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim().replace(/\.git$/, "").replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const ssh = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (ssh) return `https://${ssh[1]}/${ssh[2].replace(/\.git$/, "")}`;
  return null;
}

/**
 * Forge list URLs for issue/PR browsers. Returns null when the host is unknown.
 * Prefer these when the ops UI has no in-app list for that inventory.
 */
export function forgeWorkListUrl(
  repoWebUrl: string | null | undefined,
  kind: "issue" | "pull-request",
  state: "open" | "closed" | "merged",
): string | null {
  const base = repositoryBrowseUrl(repoWebUrl);
  if (!base) return null;
  const host = (() => {
    try {
      return new URL(base).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (host === "github.com" || host.endsWith(".github.com")) {
    if (kind === "issue") {
      if (state === "open") return `${base}/issues`;
      return `${base}/issues?q=${encodeURIComponent("is:issue is:closed")}`;
    }
    if (state === "open") return `${base}/pulls`;
    if (state === "merged") {
      return `${base}/pulls?q=${encodeURIComponent("is:pr is:merged")}`;
    }
    return `${base}/pulls?q=${encodeURIComponent("is:pr is:closed is:unmerged")}`;
  }

  if (host.includes("gitlab")) {
    if (kind === "issue") {
      return state === "open"
        ? `${base}/-/issues?state=opened`
        : `${base}/-/issues?state=closed`;
    }
    if (state === "open") return `${base}/-/merge_requests?state=opened`;
    if (state === "merged") return `${base}/-/merge_requests?state=merged`;
    return `${base}/-/merge_requests?state=closed`;
  }

  return null;
}

export function executionStageLabel(execution: WorkItem["execution"]): string {
  switch (execution) {
    case "queued":
      return "Queued";
    case "preparing":
      return "Preparing";
    case "running":
      return "Running";
    case "validating":
      return "Validating";
    case "awaiting-approval":
      return "Waiting for approval";
    case "integrating":
      return "Integrating";
    case "reporting":
      return "Reporting";
    case "terminal":
      return "Completed";
    default:
      return execution;
  }
}
