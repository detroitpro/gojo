import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppSelect as Select } from "@/ui/AppSelect";
import { Pause, Play } from "lucide-react";

import {
  getDashboard,
  getDashboardImpact,
  getDashboardOverview,
  pauseInstance,
  resumeInstance,
  useOperationsStore,
} from "@/contexts/operations/contract";
import { AppButton } from "@/ui/AppButton";
import { PageHeader, PageHeaderActions } from "@/ui/PageHeader";
import { StatGrid } from "@/ui/StatGrid";
import { StatTile } from "@/ui/StatTile";
import { StatusBadge } from "@/ui/StatusBadge";
import { RunHistoryStrip } from "@/ui/RunHistoryStrip";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { formatRunSuccessRate } from "@/kernel/run-success-rate";
import { compareLabel } from "@/kernel/stat-metrics";
import { pausedStatus } from "@/kernel/status-icons";
import type {
  DashboardImpact,
  DashboardOverviewProject,
  DashboardPreviousStats,
} from "@/contexts/operations/types";

type ImpactRange = "30d" | "90d" | "all";

const RANGE_OPTIONS: Array<{ value: ImpactRange; label: string }> = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "Lifetime" },
];

/** Scope sentinels for the header project Select (not real project ids). */
const SCOPE_ENABLED = "enabled";
const SCOPE_ALL = "all";

export function DashboardView() {
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [runningRuns, setRunningRuns] = useState(0);
  const [waitingRuns, setWaitingRuns] = useState(0);
  const [projectCount, setProjectCount] = useState(0);
  const [enabledProjectCount, setEnabledProjectCount] = useState(0);
  const [agentCount, setAgentCount] = useState(0);
  const [enabledAgentCount, setEnabledAgentCount] = useState(0);
  const [scheduleCount, setScheduleCount] = useState(0);
  const [enabledScheduleCount, setEnabledScheduleCount] = useState(0);
  const [runsTotal, setRunsTotal] = useState(0);
  const [dashboardPrevious, setDashboardPrevious] = useState<DashboardPreviousStats | null>(null);
  const [projects, setProjects] = useState<DashboardOverviewProject[]>([]);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [impact, setImpact] = useState<DashboardImpact | null>(null);

  const projectFilter = params.get("projectId") ?? "";
  const includeDisabled = params.get("projects") === "all";
  const rawRange = params.get("range");
  const impactRange: ImpactRange = rawRange === "90d" || rawRange === "all" ? rawRange : "30d";

  const projectSelectValue = projectFilter
    ? projectFilter
    : includeDisabled
      ? SCOPE_ALL
      : SCOPE_ENABLED;

  const setProjectSelect = useCallback(
    (value: string) => {
      const next = new URLSearchParams(params);
      if (value === SCOPE_ENABLED) {
        next.delete("projectId");
        next.delete("projects");
      } else if (value === SCOPE_ALL) {
        next.delete("projectId");
        next.set("projects", "all");
      } else {
        next.set("projectId", value);
        next.delete("projects");
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const setImpactRange = useCallback(
    (r: ImpactRange) => {
      const next = new URLSearchParams(params);
      if (r === "30d") next.delete("range");
      else next.set("range", r);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const visibleProjects = useMemo(() => {
    if (projectFilter) return projects.filter((p) => p.id === projectFilter);
    if (includeDisabled) return projects;
    return projects.filter((p) => p.enabled);
  }, [projects, projectFilter, includeDisabled]);

  const projectOptions = useMemo(() => {
    const listed = projects.filter(
      (p) => includeDisabled || p.enabled || p.id === projectFilter,
    );
    return [
      { value: SCOPE_ENABLED, label: "All enabled projects" },
      { value: SCOPE_ALL, label: "All projects (incl. disabled)" },
      ...listed.map((p) => ({
        value: p.id,
        label: p.enabled ? p.name : `${p.name} (disabled)`,
      })),
    ];
  }, [projects, includeDisabled, projectFilter]);

  const impactCompareLabel = compareLabel("previousWindow", impact?.range);
  const runsCompareLabel = compareLabel("asOf", dashboardPrevious?.compareWindow);

  function withProjectQuery(base: Record<string, string> = {}): string {
    const search = new URLSearchParams(base);
    if (projectFilter) search.set("projectId", projectFilter);
    const s = search.toString();
    return s ? `?${s}` : "";
  }
  function impactWindowQuery(base: Record<string, string> = {}): string {
    const search = new URLSearchParams(base);
    if (projectFilter) search.set("projectId", projectFilter);
    if (impact?.window.from) search.set("from", impact.window.from);
    if (impact?.window.to) search.set("to", impact.window.to);
    if (impactRange !== "all") search.set("range", impactRange);
    const s = search.toString();
    return s ? `?${s}` : "";
  }

  const projectsRoute = `/projects${withProjectQuery()}`;
  const agentsRoute = `/agents${withProjectQuery()}`;
  const schedulesRoute = `/schedules${withProjectQuery()}`;
  const runsRoute = `/runs${withProjectQuery()}`;
  const succeededRunsRoute = `/runs${impactWindowQuery({ state: "Succeeded" })}`;
  const mergedRoute = `/integrations${impactWindowQuery({ status: "merged" })}`;
  const commitsRoute = `/integrations${impactWindowQuery({ status: "committed" })}`;
  const prsOpenRoute = useMemo(() => {
    const total = impact?.totals.prsOpen ?? 0;
    if (total <= 0) return undefined;
    if (projectFilter) return `/projects/${projectFilter}/overview#delivery`;
    return `/projects?hasOpenPrs=1`;
  }, [impact, projectFilter]);

  const categoryRoute = (category: string) =>
    `/impact${impactWindowQuery({ category })}`;

  const load = useCallback(async () => {
    setError("");
    try {
      const [dashboard, overview] = await Promise.all([getDashboard(), getDashboardOverview()]);
      setPaused(dashboard.paused);
      setRunningRuns(dashboard.runningRuns ?? 0);
      setWaitingRuns(dashboard.waitingRuns ?? 0);
      setProjectCount(dashboard.projects);
      setEnabledProjectCount(dashboard.enabledProjects);
      setAgentCount(dashboard.agents);
      setEnabledAgentCount(dashboard.enabledAgents);
      setScheduleCount(dashboard.schedules);
      setEnabledScheduleCount(dashboard.enabledSchedules);
      setRunsTotal(dashboard.runs);
      setDashboardPrevious(dashboard.previous ?? null);
      setProjects(overview.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadImpact = useCallback(async () => {
    try {
      const result = await getDashboardImpact({
        ...(projectFilter ? { projectId: projectFilter } : {}),
        range: impactRange,
      });
      setImpact(result);
    } catch {
      setImpact(null);
    }
  }, [projectFilter, impactRange]);

  useBindStoreRefresh(useOperationsStore.getState(), load);
  useBindStoreRefresh(useOperationsStore.getState(), loadImpact);

  useEffect(() => {
    void loadImpact();
  }, [loadImpact]);

  async function togglePause() {
    setPauseBusy(true);
    try {
      if (paused) await resumeInstance();
      else await pauseInstance();
      await load();
    } finally {
      setPauseBusy(false);
    }
  }

  const rangeValue = RANGE_OPTIONS.find((o) => o.value === impactRange) ?? RANGE_OPTIONS[0];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live scheduler pulse — what is running, waiting, and shipping"
        actions={
          <PageHeaderActions>
            {projects.length > 0 ? (
              <div className="dashboard-project-filter">
                <Select
                  inputId="dashboard-project-filter"
                  aria-label="Project"
                  value={
                    projectOptions.find((o) => o.value === projectSelectValue) ??
                    projectOptions[0]
                  }
                  options={projectOptions}
                  onChange={(opt) => setProjectSelect(opt?.value ?? SCOPE_ENABLED)}
                  isSearchable={false}
                />
              </div>
            ) : null}
            {paused ? (
              <StatusBadge tone={pausedStatus().tone} label={pausedStatus().label} />
            ) : null}
            <AppButton
              loading={pauseBusy}
              loadingLabel="Working…"
              onClick={() => void togglePause()}
              iconBefore={paused ? <Play size={16} /> : <Pause size={16} />}
            >
              {paused ? "Resume scheduler" : "Pause scheduler"}
            </AppButton>
          </PageHeaderActions>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <div className="empty">Loading ops overview…</div> : null}

      {!loading && !error ? (
        <>
          <div className={`status-band${paused ? " is-paused" : ""}`}>
            <div className="status-band-primary">
              <div className="label">{paused ? "Scheduler" : "Active now"}</div>
              <div className={`value${paused ? " is-paused" : ""}`}>
                {paused ? "Paused" : runningRuns}
              </div>
              <div className="hint">
                {paused ? (
                  "Cron stays quiet until you resume"
                ) : (
                  <>
                    {waitingRuns} waiting in queue · <Link to="/queue">open queue</Link>
                  </>
                )}
              </div>
            </div>
            <StatGrid className="status-band-secondary">
              <StatTile
                metricKey="dashboard.projects"
                value={`${enabledProjectCount}/${projectCount}`}
                to={projectsRoute}
              />
              <StatTile
                metricKey="dashboard.agents"
                value={`${enabledAgentCount}/${agentCount}`}
                to={agentsRoute}
              />
              <StatTile
                metricKey="dashboard.schedules"
                value={`${enabledScheduleCount}/${scheduleCount}`}
                to={schedulesRoute}
              />
              <StatTile
                metricKey="dashboard.runs"
                value={runsTotal}
                previous={dashboardPrevious?.runs}
                compareLabel={runsCompareLabel}
                to={runsRoute}
              />
            </StatGrid>
          </div>

          {impact ? (
            <section className="panel">
              <div className="panel-header impact-header">
                <span>Impact</span>
                <div style={{ minWidth: 180 }}>
                  <Select
                    inputId="dashboard-impact-range"
                    aria-label="Impact time range"
                    value={rangeValue}
                    options={RANGE_OPTIONS}
                    onChange={(opt) => opt && setImpactRange(opt.value as ImpactRange)}
                    isSearchable={false}
                  />
                </div>
              </div>
              <div className="panel-body">
                <StatGrid>
                  <StatTile
                    metricKey="impact.mergedRuns"
                    value={impact.totals.mergedRuns}
                    previous={impact.previousTotals?.mergedRuns}
                    compareLabel={impactCompareLabel}
                    to={mergedRoute}
                  />
                  <StatTile
                    metricKey="impact.prsOpen"
                    value={impact.totals.prsOpen}
                    previous={impact.previousTotals?.prsOpen}
                    compareLabel={impactCompareLabel}
                    to={prsOpenRoute}
                  />
                  <StatTile
                    metricKey="impact.mergeRate"
                    value={impact.totals.mergeRate}
                    previous={impact.previousTotals?.mergeRate}
                    compareLabel={impactCompareLabel}
                    to={mergedRoute}
                  />
                  <StatTile
                    metricKey="impact.commits"
                    value={impact.totals.commits}
                    previous={impact.previousTotals?.commits}
                    compareLabel={impactCompareLabel}
                    to={commitsRoute}
                  />
                  <StatTile
                    metricKey="impact.succeededRuns"
                    value={impact.totals.succeededRuns}
                    previous={impact.previousTotals?.succeededRuns}
                    compareLabel={impactCompareLabel}
                    to={succeededRunsRoute}
                  />
                </StatGrid>

                {impact.categoryTotals.length > 0 ? (
                  <StatGrid>
                    {impact.categoryTotals.map((entry) => (
                      <StatTile
                        key={entry.category}
                        metricKey={`impact.category.${entry.category}`}
                        value={entry.runs}
                        to={categoryRoute(entry.category)}
                      />
                    ))}
                  </StatGrid>
                ) : (
                  <div className="muted text-sm impact-empty">
                    No impact items recorded in this range
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {projects.length === 0 ? (
            <div className="empty">
              No projects yet — add one from Projects, then Sync its gojo.yaml
            </div>
          ) : (
            <>
              {visibleProjects.length === 0 ? (
                <div className="empty">
                  {projectFilter
                    ? "No project matches this filter"
                    : includeDisabled
                      ? "No projects match this filter"
                      : "No enabled projects — choose “All projects (incl. disabled)” to see them"}
                </div>
              ) : (
                visibleProjects.map((project) => (
                  <section key={project.id} className="list-section">
                    <div className="list-section__header">
                      <h2 className="list-section__title list-section__title--plain">
                        <Link to={`/projects/${project.id}`} className="entity-name">
                          {project.name}
                        </Link>
                      </h2>
                      <span className="list-section__meta">
                        {project.agents.length} agent{project.agents.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {project.agents.length === 0 ? (
                      <div className="muted">No enabled agents</div>
                    ) : (
                      <div className="table-wrap">
                        <table className="data dashboard-task-table">
                          <thead>
                            <tr>
                              <th className="dashboard-col-task">Agent</th>
                              <th className="dashboard-col-runs">Recent runs</th>
                              <th className="dashboard-col-rate">Success</th>
                            </tr>
                          </thead>
                          <tbody>
                            {project.agents.map((agent) => (
                              <tr key={agent.id}>
                                <td className="dashboard-col-task">
                                  <Link to={`/agents/${agent.id}`} className="entity-name">
                                    {agent.name}
                                  </Link>
                                  {agent.description ? (
                                    <div className="muted text-sm">{agent.description}</div>
                                  ) : null}
                                </td>
                                <td className="dashboard-col-runs">
                                  <RunHistoryStrip runs={agent.recentRuns} />
                                </td>
                                <td className="dashboard-col-rate mono">
                                  {formatRunSuccessRate(agent.recentRuns)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                ))
              )}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
