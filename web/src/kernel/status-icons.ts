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

export type StatusIconSpec = {
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
      return { tone: "neutral", label };
    case "pull-request":
      return { tone: "neutral", label };
    case "issue":
      return { tone: "neutral", label };
    case "ticket":
      return { tone: "neutral", label };
    case "incident":
      return { tone: "warn", label };
    case "deployment":
      return { tone: "neutral", label };
    default:
      return { tone: "neutral", label };
  }
}

export function workResultStatus(
  item: Pick<WorkItem, "resolution" | "delivery" | "outcome">,
): StatusIconSpec {
  const label = workResultLabel(item);
  if (item.resolution === "operator") {
    return { tone: "neutral", label };
  }
  if (item.delivery === "merged") {
    return { tone: "success", label };
  }
  if (item.delivery === "closed") {
    return { tone: "warn", label };
  }
  if (item.delivery !== "none") {
    return deliveryStatus(item.delivery);
  }
  switch (item.outcome) {
    case "succeeded":
      return { tone: "success", label };
    case "failed":
      return { tone: "failed", label };
    case "canceled":
      return { tone: "warn", label };
    case "no-change":
      return { tone: "neutral", label };
    default:
      return { tone: "neutral", label };
  }
}

export function executionStatus(execution: WorkExecution | string): StatusIconSpec {
  const label = titleCase(execution);
  switch (execution) {
    case "queued":
      return { tone: "queued", label };
    case "preparing":
      return { tone: "running", label };
    case "running":
      return { tone: "running", label };
    case "validating":
      return { tone: "running", label };
    case "awaiting-approval":
      return { tone: "warn", label };
    case "integrating":
      return { tone: "running", label };
    case "reporting":
      return { tone: "running", label };
    case "terminal":
      return { tone: "neutral", label };
    case "none":
      return { tone: "neutral", label };
    default:
      return { tone: "neutral", label };
  }
}

export function deliveryStatus(delivery: WorkDelivery | string): StatusIconSpec {
  const label = titleCase(delivery);
  switch (delivery) {
    case "draft":
      return { tone: "neutral", label };
    case "open":
      return { tone: "queued", label };
    case "review":
      return { tone: "queued", label };
    case "blocked":
      return { tone: "failed", label };
    case "merged":
      return { tone: "success", label };
    case "closed":
      return { tone: "warn", label };
    case "none":
      return { tone: "neutral", label };
    default:
      return { tone: "neutral", label };
  }
}

export function attentionStatus(attention: WorkAttention | string): StatusIconSpec {
  const label =
    attention === "none" ? "None" : attentionReasonLabel(attention as WorkAttention);
  switch (attention) {
    case "approval":
      return { tone: "warn", label };
    case "blocked":
      return { tone: "failed", label };
    case "stale":
      return { tone: "warn", label };
    case "sync-error":
      return { tone: "failed", label };
    case "none":
      return { tone: "neutral", label };
    default:
      return { tone: "neutral", label };
  }
}

export function syncStateStatus(syncState: SourceSyncState | string): StatusIconSpec {
  const label = titleCase(syncState);
  switch (syncState) {
    case "pending":
      return { tone: "queued", label };
    case "syncing":
      return { tone: "running", label };
    case "current":
      return { tone: "success", label };
    case "stale":
      return { tone: "warn", label };
    case "error":
      return { tone: "failed", label };
    case "unsupported":
      return { tone: "neutral", label };
    default:
      return { tone: "neutral", label };
  }
}

export function runStateStatus(state: string): StatusIconSpec {
  const tone = toneFromBadgeClass(runStateBadgeClass(state));
  const label = state;
  switch (state) {
    case "Running":
      return { tone, label };
    case "Preparing":
      return { tone, label };
    case "Validating":
      return { tone, label };
    case "Integrating":
      return { tone, label };
    case "Reporting":
      return { tone, label };
    case "Queued":
      return { tone, label };
    case "Scheduled":
      return { tone, label };
    case "Succeeded":
      return { tone, label };
    case "Failed":
    case "InfrastructureFailure":
      return { tone, label };
    case "Canceled":
      return { tone, label };
    case "TimedOut":
      return { tone, label };
    case "Conflict":
      return { tone, label };
    case "AwaitingApproval":
      return { tone, label };
    default:
      return { tone, label };
  }
}

export function verificationStatus(verification: string): StatusIconSpec {
  const tone = toneFromBadgeClass(verificationBadgeClass(verification));
  const label = titleCase(verification);
  switch (verification) {
    case "verified":
      return { tone, label };
    case "corroborated":
      return { tone, label };
    case "claimed":
      return { tone, label };
    case "rejected":
      return { tone, label };
    default:
      return { tone, label };
  }
}

export function integrationStatus(status: string): StatusIconSpec {
  const tone = toneFromBadgeClass(integrationStatusBadgeClass(status));
  const label = titleCase(status);
  switch (status) {
    case "merged":
      return { tone, label };
    case "open":
      return { tone, label };
    case "committed":
      return { tone, label };
    case "closed":
      return { tone, label };
    case "conflict":
      return { tone, label };
    case "failed":
      return { tone, label };
    case "unknown":
      return { tone, label };
    default:
      return { tone, label };
  }
}

export function approvalStatus(state: string): StatusIconSpec {
  const label = titleCase(state);
  switch (state) {
    case "pending-review":
      return { tone: "queued", label };
    case "awaiting-human":
      return { tone: "warn", label };
    case "approved":
      return { tone: "queued", label };
    case "applying":
      return { tone: "running", label };
    case "applied":
      return { tone: "success", label };
    case "held":
      return { tone: "warn", label };
    case "rejected":
    case "failed":
    case "expired":
      return { tone: "failed", label };
    default:
      return { tone: "neutral", label };
  }
}

export function enabledStatus(enabled: boolean): StatusIconSpec {
  return enabled
    ? { tone: "success", label: "Enabled" }
    : { tone: "neutral", label: "Disabled" };
}

export function provenanceStatus(provenance: string): StatusIconSpec {
  const label = titleCase(provenance);
  switch (provenance) {
    case "gojo-agent":
      return { tone: "neutral", label: "Gojo agent" };
    case "human":
      return { tone: "neutral", label };
    case "bot":
      return { tone: "neutral", label };
    case "external":
      return { tone: "neutral", label };
    default:
      return { tone: "neutral", label };
  }
}

export function channelTypeStatus(type: string): StatusIconSpec {
  const label = titleCase(type);
  switch (type) {
    case "webhook":
      return { tone: "neutral", label };
    case "email":
      return { tone: "neutral", label };
    case "slack":
    case "discord":
    case "teams":
    case "telegram":
      return { tone: "neutral", label };
    default:
      return { tone: "neutral", label };
  }
}

export function healthStatus(
  level: "ok" | "warn" | "error" | "missing" | string,
): StatusIconSpec {
  switch (level) {
    case "ok":
      return { tone: "success", label: "Healthy" };
    case "warn":
      return { tone: "warn", label: "Needs attention" };
    case "error":
      return { tone: "failed", label: "Unhealthy" };
    case "missing":
      return { tone: "neutral", label: "Missing" };
    default:
      return { tone: "neutral", label: titleCase(level) };
  }
}

export function pausedStatus(): StatusIconSpec {
  return { tone: "warn", label: "Paused" };
}
