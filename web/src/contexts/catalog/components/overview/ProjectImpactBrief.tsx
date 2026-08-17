import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSelect as Select } from "@/ui/AppSelect";
import { ArrowRight } from "lucide-react";

import { getDashboardImpact, useOperationsStore } from "@/contexts/operations/contract";
import type { DashboardImpact } from "@/contexts/operations/contract";
import { listIntegrations } from "@/contexts/delivery/contract";
import { listProjectWork } from "@/contexts/work/contract";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useSoftLoading } from "@/platform/useSoftLoading";
import type { AvailableWorkInventory } from "@/kernel/project-overview";
import { forgeWorkListUrl } from "@/kernel/project-overview";
import { compareLabel } from "@/kernel/stat-metrics";
import { AppButton } from "@/ui/AppButton";
import { AppSectionMessage } from "@/ui/AppSectionMessage";
import { StatTile } from "@/ui/StatTile";

type ImpactRange = "30d" | "90d" | "all";

const RANGE_OPTIONS: Array<{ value: ImpactRange; label: string }> = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "Lifetime" },
];

export type ProjectImpactBriefProps = {
  projectId: string;
  /** @deprecated */
  openPrTotal?: number;
  availableWork?: AvailableWorkInventory;
  repositoryWebUrl?: string | null;
};

export function ProjectImpactBrief({
  projectId,
  availableWork = { openIssues: 0, openPullRequests: 0 },
  repositoryWebUrl = null,
}: ProjectImpactBriefProps) {
  const [impact, setImpact] = useState<DashboardImpact | null>(null);
  const [impactRange, setImpactRange] = useState<ImpactRange>("30d");
  const [closedIssuesInPeriod, setClosedIssuesInPeriod] = useState<number | null>(null);
  const [mergedPrsInPeriod, setMergedPrsInPeriod] = useState<number | null>(null);
  const [closedPrsInPeriod, setClosedPrsInPeriod] = useState<number | null>(null);
  const [openIssuesTotal, setOpenIssuesTotal] = useState<number | null>(null);
  const [openPullRequestsTotal, setOpenPullRequestsTotal] = useState<number | null>(null);
  const [openIntegrationPrs, setOpenIntegrationPrs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const soft = useSoftLoading(Boolean(impact));

  function windowQs(base: Record<string, string> = {}): string {
    const search = new URLSearchParams(base);
    if (projectId) search.set("projectId", projectId);
    if (impact?.window.from) search.set("from", impact.window.from);
    if (impact?.window.to) search.set("to", impact.window.to);
    if (impactRange !== "all") search.set("range", impactRange);
    const s = search.toString();
    return s ? `?${s}` : "";
  }

  const mergedRoute = `/integrations${windowQs({ status: "merged" })}`;
  const commitsRoute = `/integrations${windowQs({ status: "committed" })}`;
  const succeededRunsRoute = `/runs${windowQs({ state: "Succeeded" })}`;
  const openPrsIntegrationsRoute = `/integrations?projectId=${encodeURIComponent(projectId)}&status=open`;
  const projectImpactRoute = `/projects/${projectId}/impact`;

  const rangeLabel =
    impactRange === "90d" ? "Last 90 days" : impactRange === "all" ? "Lifetime" : "Last 30 days";

  const displayOpenIssues = openIssuesTotal ?? availableWork.openIssues;
  const displayOpenPullRequests = openPullRequestsTotal ?? availableWork.openPullRequests;
  const displayOpenPrs =
    (openIntegrationPrs ?? 0) > 0 ? openIntegrationPrs ?? 0 : displayOpenPullRequests;

  const openIssuesHref = forgeWorkListUrl(repositoryWebUrl, "issue", "open");
  const closedIssuesHref = forgeWorkListUrl(repositoryWebUrl, "issue", "closed");
  const openPullsHref = forgeWorkListUrl(repositoryWebUrl, "pull-request", "open");
  const mergedPullsHref = forgeWorkListUrl(repositoryWebUrl, "pull-request", "merged");
  const closedPullsHref = forgeWorkListUrl(repositoryWebUrl, "pull-request", "closed");

  const openPrsLink = useMemo<{ to?: string; href?: string }>(() => {
    if ((openIntegrationPrs ?? 0) > 0) return { to: openPrsIntegrationsRoute };
    if (openPullsHref) return { href: openPullsHref };
    return {};
  }, [openIntegrationPrs, openPrsIntegrationsRoute, openPullsHref]);

  const mergedPrsLink = useMemo<{ to?: string; href?: string }>(() => {
    if ((mergedPrsInPeriod ?? 0) > 0) return { to: mergedRoute };
    if (mergedPullsHref) return { href: mergedPullsHref };
    return {};
  }, [mergedPrsInPeriod, mergedRoute, mergedPullsHref]);

  const showBacklog =
    Boolean(repositoryWebUrl) ||
    displayOpenIssues > 0 ||
    (closedIssuesInPeriod ?? 0) > 0 ||
    (mergedPrsInPeriod ?? 0) > 0 ||
    (closedPrsInPeriod ?? 0) > 0 ||
    openIssuesTotal != null;

  const hasAnySignal =
    showBacklog ||
    (impact
      ? impact.totals.succeededRuns > 0 ||
        impact.totals.mergedRuns > 0 ||
        impact.totals.commits > 0 ||
        impact.totals.prsOpened > 0 ||
        impact.categoryTotals.length > 0
      : false);

  const loadBacklogCounts = useCallback(async () => {
    const from = impact?.window.from ?? undefined;
    const to = impact?.window.to ?? undefined;
    const [
      closedIssues,
      openIssues,
      openPrs,
      mergedPrs,
      closedPrs,
      openIntegrations,
    ] = await Promise.all([
      listProjectWork(projectId, {
        limit: 1,
        offset: 0,
        history: true,
        kind: "issue",
        delivery: "closed",
        from,
        to,
      }).catch(() => null),
      listProjectWork(projectId, {
        limit: 1,
        offset: 0,
        kind: "issue",
        delivery: "open",
      }).catch(() => null),
      listProjectWork(projectId, {
        limit: 1,
        offset: 0,
        kind: "pull-request",
        delivery: "open",
      }).catch(() => null),
      listProjectWork(projectId, {
        limit: 1,
        offset: 0,
        history: true,
        kind: "pull-request",
        delivery: "merged",
        from,
        to,
      }).catch(() => null),
      listProjectWork(projectId, {
        limit: 1,
        offset: 0,
        history: true,
        kind: "pull-request",
        delivery: "closed",
        from,
        to,
      }).catch(() => null),
      listIntegrations({
        limit: 1,
        offset: 0,
        status: "open",
        projectId,
      }).catch(() => null),
    ]);
    setClosedIssuesInPeriod(closedIssues?.total ?? null);
    setOpenIssuesTotal(openIssues?.total ?? null);
    setOpenPullRequestsTotal(openPrs?.total ?? null);
    setMergedPrsInPeriod(mergedPrs?.total ?? null);
    setClosedPrsInPeriod(closedPrs?.total ?? null);
    setOpenIntegrationPrs(openIntegrations?.total ?? null);
  }, [projectId, impact?.window.from, impact?.window.to]);

  const loadImpact = useCallback(async () => {
    setError(null);
    try {
      await soft.run(async () => {
        const result = await getDashboardImpact({ projectId, range: impactRange });
        setImpact(result);
        await loadBacklogCounts();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load impact");
    }
  }, [projectId, impactRange, soft.run, loadBacklogCounts]);

  useEffect(() => {
    setImpact(null);
    setClosedIssuesInPeriod(null);
    setMergedPrsInPeriod(null);
    setClosedPrsInPeriod(null);
    setOpenIssuesTotal(null);
    setOpenPullRequestsTotal(null);
    setOpenIntegrationPrs(null);
    void loadImpact();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, impactRange]);

  useBindStoreRefresh(useOperationsStore.getState(), loadImpact);

  const impactCompareLbl = compareLabel("previousWindow", impact?.range);
  const rangeValue = RANGE_OPTIONS.find((o) => o.value === impactRange) ?? RANGE_OPTIONS[0];

  return (
    <section className="impact-brief panel mb-7" aria-labelledby="impact-brief-heading">
      <div className="panel-header impact-brief__header">
        <div>
          <h2 id="impact-brief-heading">Project impact</h2>
          <p className="muted text-sm mt-1">{rangeLabel} · outcomes vs prior period</p>
        </div>
        <div className="impact-brief__actions">
          <label className="sr-only" htmlFor="overview-impact-range">
            Impact time range
          </label>
          <div style={{ minWidth: 180 }}>
            <Select
              inputId="overview-impact-range"
              aria-label="Impact time range"
              value={rangeValue}
              options={RANGE_OPTIONS}
              onChange={(opt) => opt && setImpactRange(opt.value as ImpactRange)}
              isSearchable={false}
            />
          </div>
          <AppButton size="sm" to={projectImpactRoute} iconBefore={<ArrowRight size={12} />}>
            Full impact
          </AppButton>
        </div>
      </div>
      <div className="panel-body">
        {soft.loading && !impact ? (
          <div className="muted text-sm">Loading impact…</div>
        ) : error && !impact ? (
          <AppSectionMessage appearance="error">{error}</AppSectionMessage>
        ) : !hasAnySignal ? (
          <div className="muted text-sm">
            Impact data will appear after the project has completed enough runs to establish a
            reporting period.
          </div>
        ) : (
          <div className="impact-categories">
            {showBacklog ? (
              <section className="impact-category" aria-labelledby="impact-backlog">
                <h3 id="impact-backlog">Backlog</h3>
                <p className="muted text-sm impact-category__note">
                  Open counts are current inventory. Closed issues and closed/merged PRs are
                  counted in {rangeLabel.toLowerCase()}. Links open the forge list when gojo has no
                  in-app browser for that kind.
                </p>
                <div className="impact-category__metrics">
                  <StatTile
                    metricKey="work.issuesOpen"
                    value={displayOpenIssues}
                    href={openIssuesHref ?? undefined}
                  />
                  <StatTile
                    metricKey="work.issuesClosed"
                    value={closedIssuesInPeriod ?? 0}
                    href={closedIssuesHref ?? undefined}
                  />
                  <StatTile
                    metricKey="impact.prsOpen"
                    value={displayOpenPrs}
                    to={openPrsLink.to}
                    href={openPrsLink.href}
                  />
                  <StatTile
                    metricKey="work.prsMerged"
                    value={mergedPrsInPeriod ?? 0}
                    to={mergedPrsLink.to}
                    href={mergedPrsLink.href}
                  />
                  <StatTile
                    metricKey="work.prsClosed"
                    value={closedPrsInPeriod ?? 0}
                    href={closedPullsHref ?? undefined}
                  />
                </div>
              </section>
            ) : null}
            {impact ? (
              <section className="impact-category" aria-labelledby="impact-delivery">
                <h3 id="impact-delivery">Delivery</h3>
                <p className="muted text-sm impact-category__note">
                  Merged work, reliability, and activity for {rangeLabel.toLowerCase()}. Commits are
                  activity indicators — not inherently positive impact.
                </p>
                <div className="impact-category__metrics impact-category__metrics--delivery">
                  <StatTile
                    metricKey="impact.mergedRuns"
                    value={impact.totals.mergedRuns}
                    previous={impact.previousTotals?.mergedRuns}
                    compareLabel={impactCompareLbl}
                    to={mergedRoute}
                  />
                  <StatTile
                    metricKey="impact.mergeRate"
                    value={impact.totals.mergeRate}
                    previous={impact.previousTotals?.mergeRate}
                    compareLabel={impactCompareLbl}
                  />
                  <StatTile
                    metricKey="impact.succeededRuns"
                    value={impact.totals.succeededRuns}
                    previous={impact.previousTotals?.succeededRuns}
                    compareLabel={impactCompareLbl}
                    to={succeededRunsRoute}
                  />
                  <StatTile
                    metricKey="impact.commits"
                    value={impact.totals.commits}
                    previous={impact.previousTotals?.commits}
                    compareLabel={impactCompareLbl}
                    to={commitsRoute}
                  />
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
