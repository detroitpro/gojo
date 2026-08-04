import { ok, type Result } from "@/kernel";

import type {
  DashboardImpact,
  DashboardOverview,
  DashboardReadModel,
  DashboardSummary,
  QueueSnapshot,
} from "../ports/dashboard-read-model";

export type DashboardDeps = { reads: DashboardReadModel };

export async function dashboardSummaryQuery(
  deps: DashboardDeps,
  input: { compare?: string | null },
): Promise<Result<DashboardSummary>> {
  return ok(deps.reads.summary(input.compare ?? ""));
}

export async function dashboardOverviewQuery(
  deps: DashboardDeps,
): Promise<Result<DashboardOverview>> {
  return ok(deps.reads.overview());
}

export async function dashboardImpactQuery(
  deps: DashboardDeps,
  input: {
    projectId?: string | null;
    from?: string | null;
    to?: string | null;
    range?: string | null;
  },
): Promise<Result<DashboardImpact>> {
  return ok(deps.reads.impact(input));
}

export async function queueSnapshotQuery(
  deps: DashboardDeps,
  input: { limit: number; offset: number; sort: string; order: "asc" | "desc" },
): Promise<Result<QueueSnapshot>> {
  return ok(deps.reads.queue(input));
}
