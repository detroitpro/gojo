/** Labels and badge classes for automation-impact accounting. */

import { impactCategoryLabel as catalogImpactCategoryLabel } from "./stat-metrics";

/** Outcome label for a category; single source is the impact.category.* MetricSpec catalog. */
export function impactCategoryLabel(category: string): string {
  return catalogImpactCategoryLabel(category);
}

export function formatMergeRate(rate: number | null): string {
  if (rate === null) {
    return "—";
  }
  return `${Math.round(rate * 100)}%`;
}

const VERIFICATION_BADGES: Record<string, string> = {
  verified: "badge-success",
  corroborated: "badge-queued",
  claimed: "badge-warn",
  rejected: "badge-failed",
};

export function verificationBadgeClass(verification: string): string {
  return VERIFICATION_BADGES[verification] ?? "badge-neutral";
}

const INTEGRATION_STATUS_BADGES: Record<string, string> = {
  merged: "badge-success",
  open: "badge-queued",
  committed: "badge-queued",
  closed: "badge-warn",
  conflict: "badge-failed",
  failed: "badge-failed",
  unknown: "badge-neutral",
};

export function integrationStatusBadgeClass(status: string): string {
  return INTEGRATION_STATUS_BADGES[status] ?? "badge-neutral";
}
