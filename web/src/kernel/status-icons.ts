import type { FunctionalComponent } from "vue";
import {
  Ban,
  Bot,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleQuestionMark,
  CircleX,
  Clock,
  Eye,
  FileText,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Hourglass,
  Inbox,
  Loader,
  MessageSquare,
  Minus,
  OctagonAlert,
  Pause,
  Play,
  Power,
  RefreshCw,
  Rocket,
  ShieldAlert,
  Ticket,
  TriangleAlert,
  User,
  Webhook,
  WifiOff,
  X,
} from "lucide-vue-next";

import {
  integrationStatusBadgeClass,
  verificationBadgeClass,
} from "./impact-format";
import { runStateBadgeClass } from "./run-state-badge";
import { attentionReasonLabel } from "./work-attention";
import { workKindLabel, workResultLabel } from "./work-display";
import type {
  SourceSyncState,
  WorkAttention,
  WorkDelivery,
  WorkExecution,
  WorkItem,
} from "@gojo/contracts/types";

export type BadgeTone =
  | "success"
  | "failed"
  | "warn"
  | "running"
  | "queued"
  | "neutral";

export type LucideIcon = FunctionalComponent;

export type StatusIconSpec = {
  icon: LucideIcon;
  tone: BadgeTone;
  label: string;
};

function toneClass(tone: BadgeTone): string {
  return `badge-${tone}`;
}

export function badgeToneClass(tone: BadgeTone): string {
  return toneClass(tone);
}

/** Map legacy badge-* class strings to BadgeTone. */
export function toneFromBadgeClass(badgeClass: string): BadgeTone {
  if (badgeClass.includes("badge-success")) return "success";
  if (badgeClass.includes("badge-failed")) return "failed";
  if (badgeClass.includes("badge-warn")) return "warn";
  if (badgeClass.includes("badge-running")) return "running";
  if (badgeClass.includes("badge-queued")) return "queued";
  return "neutral";
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function workKindStatus(kind: string): StatusIconSpec {
  const label = workKindLabel({ kind });
  switch (kind) {
    case "run":
      return { icon: Play, tone: "neutral", label };
    case "pull-request":
      return { icon: GitPullRequest, tone: "neutral", label };
    case "issue":
      return { icon: CircleDot, tone: "neutral", label };
    case "ticket":
      return { icon: Ticket, tone: "neutral", label };
    case "incident":
      return { icon: OctagonAlert, tone: "warn", label };
    case "deployment":
      return { icon: Rocket, tone: "neutral", label };
    default:
      return { icon: CircleQuestionMark, tone: "neutral", label };
  }
}

export function workResultStatus(
  item: Pick<WorkItem, "resolution" | "delivery" | "outcome">,
): StatusIconSpec {
  const label = workResultLabel(item);
  if (item.resolution === "operator") {
    return { icon: Eye, tone: "neutral", label };
  }
  if (item.delivery === "merged") {
    return { icon: GitMerge, tone: "success", label };
  }
  if (item.delivery === "closed") {
    return { icon: GitPullRequestClosed, tone: "warn", label };
  }
  if (item.delivery !== "none") {
    return deliveryStatus(item.delivery);
  }
  switch (item.outcome) {
    case "succeeded":
      return { icon: CircleCheck, tone: "success", label };
    case "failed":
      return { icon: CircleX, tone: "failed", label };
    case "canceled":
      return { icon: Ban, tone: "warn", label };
    case "no-change":
      return { icon: Minus, tone: "neutral", label };
    default:
      return { icon: CircleQuestionMark, tone: "neutral", label };
  }
}

export function executionStatus(execution: WorkExecution | string): StatusIconSpec {
  const label = titleCase(execution);
  switch (execution) {
    case "queued":
      return { icon: Inbox, tone: "queued", label };
    case "preparing":
      return { icon: Hourglass, tone: "running", label };
    case "running":
      return { icon: Loader, tone: "running", label };
    case "validating":
      return { icon: ShieldAlert, tone: "running", label };
    case "awaiting-approval":
      return { icon: MessageSquare, tone: "warn", label };
    case "integrating":
      return { icon: GitMerge, tone: "running", label };
    case "reporting":
      return { icon: FileText, tone: "running", label };
    case "terminal":
      return { icon: CircleCheck, tone: "neutral", label };
    case "none":
      return { icon: Minus, tone: "neutral", label };
    default:
      return { icon: CircleQuestionMark, tone: "neutral", label };
  }
}

export function deliveryStatus(delivery: WorkDelivery | string): StatusIconSpec {
  const label = titleCase(delivery);
  switch (delivery) {
    case "draft":
      return { icon: GitPullRequestDraft, tone: "neutral", label };
    case "open":
      return { icon: GitPullRequest, tone: "queued", label };
    case "review":
      return { icon: Eye, tone: "queued", label };
    case "blocked":
      return { icon: Ban, tone: "failed", label };
    case "merged":
      return { icon: GitMerge, tone: "success", label };
    case "closed":
      return { icon: GitPullRequestClosed, tone: "warn", label };
    case "none":
      return { icon: Minus, tone: "neutral", label };
    default:
      return { icon: CircleQuestionMark, tone: "neutral", label };
  }
}

export function attentionStatus(attention: WorkAttention | string): StatusIconSpec {
  const label =
    attention === "none" ? "None" : attentionReasonLabel(attention as WorkAttention);
  switch (attention) {
    case "approval":
      return { icon: ShieldAlert, tone: "warn", label };
    case "blocked":
      return { icon: Ban, tone: "failed", label };
    case "stale":
      return { icon: Clock, tone: "warn", label };
    case "sync-error":
      return { icon: WifiOff, tone: "failed", label };
    case "none":
      return { icon: Minus, tone: "neutral", label };
    default:
      return { icon: CircleQuestionMark, tone: "neutral", label };
  }
}

export function syncStateStatus(syncState: SourceSyncState | string): StatusIconSpec {
  const label = titleCase(syncState);
  switch (syncState) {
    case "pending":
      return { icon: Hourglass, tone: "queued", label };
    case "syncing":
      return { icon: RefreshCw, tone: "running", label };
    case "current":
      return { icon: CircleCheck, tone: "success", label };
    case "stale":
      return { icon: Clock, tone: "warn", label };
    case "error":
      return { icon: TriangleAlert, tone: "failed", label };
    case "unsupported":
      return { icon: CircleQuestionMark, tone: "neutral", label };
    default:
      return { icon: CircleQuestionMark, tone: "neutral", label };
  }
}

export function runStateStatus(state: string): StatusIconSpec {
  const tone = toneFromBadgeClass(runStateBadgeClass(state));
  const label = state;
  switch (state) {
    case "Running":
      return { icon: Loader, tone, label };
    case "Preparing":
      return { icon: Hourglass, tone, label };
    case "Validating":
      return { icon: ShieldAlert, tone, label };
    case "Integrating":
      return { icon: GitMerge, tone, label };
    case "Reporting":
      return { icon: FileText, tone, label };
    case "Queued":
      return { icon: Inbox, tone, label };
    case "Scheduled":
      return { icon: Clock, tone, label };
    case "Succeeded":
      return { icon: CircleCheck, tone, label };
    case "Failed":
    case "InfrastructureFailure":
      return { icon: CircleX, tone, label };
    case "Canceled":
      return { icon: Ban, tone, label };
    case "TimedOut":
      return { icon: Hourglass, tone, label };
    case "Conflict":
      return { icon: TriangleAlert, tone, label };
    case "AwaitingApproval":
      return { icon: MessageSquare, tone, label };
    default:
      return { icon: CircleQuestionMark, tone, label };
  }
}

export function verificationStatus(verification: string): StatusIconSpec {
  const tone = toneFromBadgeClass(verificationBadgeClass(verification));
  const label = titleCase(verification);
  switch (verification) {
    case "verified":
      return { icon: CircleCheck, tone, label };
    case "corroborated":
      return { icon: Eye, tone, label };
    case "claimed":
      return { icon: MessageSquare, tone, label };
    case "rejected":
      return { icon: X, tone, label };
    default:
      return { icon: CircleQuestionMark, tone, label };
  }
}

export function integrationStatus(status: string): StatusIconSpec {
  const tone = toneFromBadgeClass(integrationStatusBadgeClass(status));
  const label = titleCase(status);
  switch (status) {
    case "merged":
      return { icon: GitMerge, tone, label };
    case "open":
      return { icon: GitPullRequest, tone, label };
    case "committed":
      return { icon: CircleCheck, tone, label };
    case "closed":
      return { icon: GitPullRequestClosed, tone, label };
    case "conflict":
      return { icon: TriangleAlert, tone, label };
    case "failed":
      return { icon: CircleX, tone, label };
    case "unknown":
      return { icon: CircleQuestionMark, tone, label };
    default:
      return { icon: CircleQuestionMark, tone, label };
  }
}

export function approvalStatus(state: string): StatusIconSpec {
  const label = titleCase(state);
  switch (state) {
    case "pending-review":
      return { icon: Eye, tone: "queued", label };
    case "awaiting-human":
      return { icon: User, tone: "warn", label };
    case "approved":
      return { icon: CircleCheck, tone: "queued", label };
    case "applying":
      return { icon: Loader, tone: "running", label };
    case "applied":
      return { icon: GitMerge, tone: "success", label };
    case "held":
      return { icon: Pause, tone: "warn", label };
    case "rejected":
    case "failed":
    case "expired":
      return { icon: CircleX, tone: "failed", label };
    default:
      return { icon: CircleQuestionMark, tone: "neutral", label };
  }
}

export function enabledStatus(enabled: boolean): StatusIconSpec {
  return enabled
    ? { icon: Power, tone: "success", label: "Enabled" }
    : { icon: Pause, tone: "neutral", label: "Disabled" };
}

export function provenanceStatus(provenance: string): StatusIconSpec {
  const label = titleCase(provenance);
  switch (provenance) {
    case "gojo-agent":
      return { icon: Bot, tone: "neutral", label: "Gojo agent" };
    case "human":
      return { icon: User, tone: "neutral", label };
    case "bot":
      return { icon: Bot, tone: "neutral", label };
    case "external":
      return { icon: Webhook, tone: "neutral", label };
    default:
      return { icon: CircleQuestionMark, tone: "neutral", label };
  }
}

export function channelTypeStatus(type: string): StatusIconSpec {
  const label = titleCase(type);
  switch (type) {
    case "webhook":
      return { icon: Webhook, tone: "neutral", label };
    case "email":
      return { icon: Inbox, tone: "neutral", label };
    case "slack":
    case "discord":
    case "teams":
    case "telegram":
      return { icon: MessageSquare, tone: "neutral", label };
    default:
      return { icon: CircleQuestionMark, tone: "neutral", label };
  }
}

export function healthStatus(
  level: "ok" | "warn" | "error" | "missing" | string,
): StatusIconSpec {
  switch (level) {
    case "ok":
      return { icon: CircleCheck, tone: "success", label: "Healthy" };
    case "warn":
      return { icon: TriangleAlert, tone: "warn", label: "Needs attention" };
    case "error":
      return { icon: CircleAlert, tone: "failed", label: "Unhealthy" };
    case "missing":
      return { icon: CircleQuestionMark, tone: "neutral", label: "Missing" };
    default:
      return { icon: CircleQuestionMark, tone: "neutral", label: titleCase(level) };
  }
}

export function pausedStatus(): StatusIconSpec {
  return { icon: Pause, tone: "warn", label: "Paused" };
}
