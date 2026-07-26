/** Labels for automation-impact accounting (categories + trust levels). */

const CATEGORY_LABELS: Record<string, string> = {
  "dependency-update": "Dependency updates",
  "bug-fix": "Bug fixes",
  "bug-prevention": "Bugs prevented",
  documentation: "Documentation",
  "test-coverage": "Test coverage",
  security: "Security",
  feature: "Features",
  performance: "Performance",
  maintenance: "Maintenance",
};

export function impactCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** e.g. "Dependency updates verified", "Bug fixes claimed". */
export function impactCountLabel(category: string, verification: string): string {
  return `${impactCategoryLabel(category)} ${verification}`;
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
