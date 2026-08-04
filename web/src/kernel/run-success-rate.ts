import type { DashboardOverviewRun } from "@gojo/contracts/types";

/** Success share of the provided runs (typically last 5). Null when empty. */
export function formatRunSuccessRate(runs: DashboardOverviewRun[]): string {
  if (runs.length === 0) {
    return "—";
  }
  const succeeded = runs.filter((run) => run.state === "Succeeded").length;
  const pct = Math.round((succeeded / runs.length) * 100);
  return `${pct}%`;
}
