import {
  Activity,
  BookOpen,
  Bug,
  CalendarClock,
  CircleCheck,
  CircleQuestionMark,
  Clock,
  FlaskConical,
  FolderGit2,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Inbox,
  Layers,
  ListChecks,
  Loader,
  Lock,
  Package,
  Percent,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  Timer,
  TriangleAlert,
  Wrench,
  Zap,
} from "lucide-vue-next";

import type { BadgeTone, LucideIcon } from "./status-icons";

/** Canonical handoff impact categories (keep in sync with HandoffImpactCategory). */
export const IMPACT_CATEGORIES = [
  "dependency-update",
  "bug-fix",
  "bug-prevention",
  "documentation",
  "test-coverage",
  "security",
  "feature",
  "performance",
  "maintenance",
] as const;

export type ImpactCategory = (typeof IMPACT_CATEGORIES)[number];

export type MetricGroup = "activity" | "delivery" | "attention" | "inventory" | "policy";
export type MetricKind = "gauge" | "cumulative" | "ratio" | "text";
export type MetricTrend = "asOf" | "previousWindow" | "none";
export type MetricDirection = "up-good" | "up-bad" | "neutral";

export interface MetricSpec {
  key: string;
  label: string;
  icon: LucideIcon;
  tone: BadgeTone;
  group: MetricGroup;
  kind: MetricKind;
  trend: MetricTrend;
  direction: MetricDirection;
  attention?: boolean;
  hint?: string;
}

function spec(
  key: string,
  label: string,
  icon: LucideIcon,
  tone: BadgeTone,
  group: MetricGroup,
  kind: MetricKind,
  trend: MetricTrend,
  direction: MetricDirection,
  extra?: Pick<MetricSpec, "attention" | "hint">,
): MetricSpec {
  return {
    key,
    label,
    icon,
    tone,
    group,
    kind,
    trend,
    direction,
    ...extra,
  };
}

export const METRICS: Record<string, MetricSpec> = {
  "work.working": spec("work.working", "Working", Loader, "running", "activity", "gauge", "asOf", "neutral"),
  "work.queued": spec("work.queued", "Queued", Inbox, "queued", "activity", "gauge", "asOf", "neutral"),
  "work.needsAttention": spec(
    "work.needsAttention",
    "Needs attention",
    TriangleAlert,
    "warn",
    "attention",
    "gauge",
    "asOf",
    "up-bad",
    { attention: true },
  ),
  "work.staleOpen": spec(
    "work.staleOpen",
    "Stale open",
    Clock,
    "warn",
    "attention",
    "gauge",
    "asOf",
    "up-bad",
    { attention: true },
  ),
  "work.verifiedOpen": spec(
    "work.verifiedOpen",
    "Verified open",
    ShieldCheck,
    "success",
    "delivery",
    "gauge",
    "asOf",
    "neutral",
  ),
  "runs.running": spec("runs.running", "Running", Loader, "running", "activity", "gauge", "asOf", "neutral"),
  "runs.waiting": spec("runs.waiting", "Waiting", Inbox, "queued", "activity", "gauge", "asOf", "neutral"),
  "impact.mergedRuns": spec(
    "impact.mergedRuns",
    "Merged",
    GitMerge,
    "success",
    "delivery",
    "cumulative",
    "previousWindow",
    "up-good",
  ),
  "impact.commits": spec(
    "impact.commits",
    "Commits",
    GitCommitHorizontal,
    "success",
    "delivery",
    "cumulative",
    "previousWindow",
    "up-good",
  ),
  "impact.mergeRate": spec(
    "impact.mergeRate",
    "Merge rate",
    Percent,
    "success",
    "delivery",
    "ratio",
    "previousWindow",
    "up-good",
  ),
  "impact.prsOpen": spec(
    "impact.prsOpen",
    "PRs open",
    GitPullRequest,
    "queued",
    "delivery",
    "gauge",
    "previousWindow",
    "neutral",
  ),
  "work.issuesOpen": spec(
    "work.issuesOpen",
    "Open issues",
    CircleQuestionMark,
    "queued",
    "inventory",
    "gauge",
    "none",
    "neutral",
    { hint: "Current open issues available to work — not an alert." },
  ),
  "work.issuesClosed": spec(
    "work.issuesClosed",
    "Closed issues",
    CircleCheck,
    "success",
    "inventory",
    "cumulative",
    "none",
    "up-good",
    { hint: "Issues closed during the selected impact period." },
  ),
  "impact.succeededRuns": spec(
    "impact.succeededRuns",
    "Succeeded runs",
    CircleCheck,
    "success",
    "activity",
    "cumulative",
    "previousWindow",
    "up-good",
  ),
  "impact.category.dependency-update": spec(
    "impact.category.dependency-update",
    "Dependency updates",
    Package,
    "success",
    "delivery",
    "cumulative",
    "none",
    "up-good",
  ),
  "impact.category.bug-fix": spec(
    "impact.category.bug-fix",
    "Bugs fixed",
    Bug,
    "success",
    "delivery",
    "cumulative",
    "none",
    "up-good",
  ),
  "impact.category.bug-prevention": spec(
    "impact.category.bug-prevention",
    "Bugs prevented",
    ShieldAlert,
    "success",
    "delivery",
    "cumulative",
    "none",
    "up-good",
  ),
  "impact.category.documentation": spec(
    "impact.category.documentation",
    "Documentation updates",
    BookOpen,
    "success",
    "delivery",
    "cumulative",
    "none",
    "up-good",
  ),
  "impact.category.test-coverage": spec(
    "impact.category.test-coverage",
    "Test updates",
    FlaskConical,
    "success",
    "delivery",
    "cumulative",
    "none",
    "up-good",
  ),
  "impact.category.security": spec(
    "impact.category.security",
    "Security fixes",
    Lock,
    "success",
    "delivery",
    "cumulative",
    "none",
    "up-good",
  ),
  "impact.category.feature": spec(
    "impact.category.feature",
    "Features shipped",
    Sparkles,
    "success",
    "delivery",
    "cumulative",
    "none",
    "up-good",
  ),
  "impact.category.performance": spec(
    "impact.category.performance",
    "Performance improvements",
    Zap,
    "success",
    "delivery",
    "cumulative",
    "none",
    "up-good",
  ),
  "impact.category.maintenance": spec(
    "impact.category.maintenance",
    "Maintenance",
    Wrench,
    "success",
    "delivery",
    "cumulative",
    "none",
    "up-good",
  ),
  "dashboard.projects": spec(
    "dashboard.projects",
    "Projects",
    FolderGit2,
    "neutral",
    "inventory",
    "text",
    "none",
    "neutral",
    { hint: "Enabled / total registered projects" },
  ),
  "dashboard.agents": spec(
    "dashboard.agents",
    "Agents",
    ListChecks,
    "neutral",
    "inventory",
    "text",
    "none",
    "neutral",
    { hint: "Enabled / total agents" },
  ),
  "dashboard.schedules": spec(
    "dashboard.schedules",
    "Schedules",
    CalendarClock,
    "neutral",
    "inventory",
    "text",
    "none",
    "neutral",
    { hint: "Enabled / total schedules" },
  ),
  "dashboard.runs": spec(
    "dashboard.runs",
    "Runs",
    Play,
    "neutral",
    "inventory",
    "gauge",
    "asOf",
    "neutral",
  ),
  "queue.running": spec(
    "queue.running",
    "Running",
    Loader,
    "running",
    "activity",
    "gauge",
    "asOf",
    "neutral",
  ),
  "queue.waiting": spec(
    "queue.waiting",
    "Waiting",
    Inbox,
    "queued",
    "activity",
    "gauge",
    "asOf",
    "neutral",
  ),
  "queue.perProject": spec(
    "queue.perProject",
    "Per project",
    Layers,
    "neutral",
    "policy",
    "gauge",
    "none",
    "neutral",
  ),
  "queue.stagger": spec(
    "queue.stagger",
    "Stagger",
    Timer,
    "neutral",
    "policy",
    "text",
    "none",
    "neutral",
  ),
  "settings.version": spec(
    "settings.version",
    "Version",
    Tag,
    "neutral",
    "inventory",
    "text",
    "none",
    "neutral",
  ),
  "settings.scheduler": spec(
    "settings.scheduler",
    "Scheduler",
    CalendarClock,
    "neutral",
    "activity",
    "text",
    "none",
    "neutral",
  ),
  "settings.telemetry": spec(
    "settings.telemetry",
    "Telemetry",
    Activity,
    "neutral",
    "activity",
    "text",
    "none",
    "neutral",
  ),
};

/** Resolve a MetricSpec for an impact category, with a neutral fallback for unknowns. */
export function impactCategorySpec(category: string): MetricSpec {
  const known = METRICS[`impact.category.${category}`];
  if (known) {
    return known;
  }
  return spec(
    `impact.category.${category}`,
    category,
    CircleQuestionMark,
    "neutral",
    "delivery",
    "cumulative",
    "none",
    "neutral",
  );
}

export function impactCategoryLabel(category: string): string {
  return impactCategorySpec(category).label;
}

export function metricTone(spec: MetricSpec, value: number | string): BadgeTone {
  const n = typeof value === "number" ? value : 0;
  if (spec.attention && n > 0) {
    return spec.tone === "failed" ? "failed" : "warn";
  }
  return spec.tone;
}

export function metricDelta(value: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined) {
    return null;
  }
  return value - previous;
}

export function deltaTone(
  spec: Pick<MetricSpec, "direction">,
  delta: number | null,
): BadgeTone {
  if (delta === null || delta === 0) {
    return "neutral";
  }
  if (spec.direction === "neutral") {
    return "neutral";
  }
  const positive = delta > 0;
  if (spec.direction === "up-good") {
    return positive ? "success" : "failed";
  }
  return positive ? "warn" : "success";
}

export function formatDelta(delta: number | null): string {
  if (delta === null) {
    return "";
  }
  if (delta > 0) {
    return `+${delta}`;
  }
  if (delta < 0) {
    return String(delta);
  }
  return "0";
}

export function metricAriaLabel(
  spec: MetricSpec,
  value: string,
  delta: number | null,
  compare?: string,
): string {
  let label = `${spec.label}: ${value}`;
  if (delta !== null) {
    label += ` (${formatDelta(delta)}`;
    if (compare) {
      label += ` ${compare}`;
    }
    label += ")";
  }
  return label;
}

export function compareLabel(
  trend: MetricTrend,
  compareWindowOrRange: string | null | undefined,
): string {
  if (trend === "none" || !compareWindowOrRange) {
    return "";
  }
  if (trend === "asOf") {
    switch (compareWindowOrRange) {
      case "24h":
        return "vs 24 hours ago";
      case "7d":
        return "vs 7 days ago";
      case "30d":
        return "vs 30 days ago";
      default:
        return `vs ${compareWindowOrRange} ago`;
    }
  }
  switch (compareWindowOrRange) {
    case "30d":
      return "vs previous 30 days";
    case "90d":
      return "vs previous 90 days";
    case "all":
      return "";
    default:
      return `vs previous ${compareWindowOrRange}`;
  }
}
