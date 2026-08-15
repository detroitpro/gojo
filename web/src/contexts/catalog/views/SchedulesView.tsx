import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppSelect as Select } from "@/ui/AppSelect";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { Power } from "lucide-react";

import {
  disableSchedule,
  enableSchedule,
  listProjects,
  listSchedules,
  useCatalogStore,
} from "@/contexts/catalog/contract";
import { listSchedulesUpcoming } from "@/contexts/scheduling/contract";
import { AppButton } from "@/ui/AppButton";
import { AppSectionMessage } from "@/ui/AppSectionMessage";
import { PageHeader } from "@/ui/PageHeader";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { EnabledBadge } from "@/ui/status/EnabledBadge";
import { SchedulesTimelineChart } from "@/ui/SchedulesTimelineChart";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useServerTable } from "@/platform/useServerTable";
import { useSoftLoading } from "@/platform/useSoftLoading";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import {
  formatAbsoluteInZone,
  formatRelativeNextRun,
  formatTimezoneLabel,
} from "@/kernel/schedule-format";
import type { Order } from "@/platform/useClientPager";
import type { Project, Schedule } from "@/contexts/catalog/types";
import type { SchedulesUpcomingResult } from "@/contexts/scheduling/types";

const SCHEDULE_SORT_ALLOWED = [
  "name",
  "projectName",
  "cronExpr",
  "nextRunAt",
  "lastRunAt",
  "enabled",
  "createdAt",
] as const;

type EnabledFilter = "all" | "enabled" | "disabled";
const ENABLED_OPTIONS: Array<{ value: EnabledFilter; label: string }> = [
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
  { value: "all", label: "All" },
];

const HORIZON_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 24, label: "24 hours" },
  { value: 168, label: "7 days" },
  { value: 720, label: "30 days" },
];

export function SchedulesView() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialSort = useMemo(() => {
    const v = searchParams.get("sort") ?? "";
    return (SCHEDULE_SORT_ALLOWED as readonly string[]).includes(v) ? v : "createdAt";
  }, [searchParams]);
  const initialOrder: Order = searchParams.get("order") === "desc" ? "desc" : "asc";
  const initialEnabled: EnabledFilter =
    searchParams.get("enabled") === "all" || searchParams.get("enabled") === "disabled"
      ? (searchParams.get("enabled") as EnabledFilter)
      : "enabled";

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState(searchParams.get("projectId") ?? "");
  const [agentFilter] = useState(searchParams.get("agentId") ?? "");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>(initialEnabled);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [horizonHours, setHorizonHours] = useState(168);
  const [upcoming, setUpcoming] = useState<SchedulesUpcomingResult | null>(null);
  const [pageError, setPageError] = useState("");

  const upcomingSoft = useSoftLoading(Boolean(upcoming));

  const table = useServerTable<Schedule>({
    defaultSort: initialSort,
    defaultOrder: initialOrder,
    watchSources: [projectFilter, agentFilter, enabledFilter, query],
    fetchPage: ({ limit, offset, sort, order }) =>
      listSchedules({
        limit,
        offset,
        sort,
        order,
        projectId: projectFilter || undefined,
        agentId: agentFilter || undefined,
        enabled: enabledFilter,
        q: query || undefined,
      }),
  });

  const loadProjects = useCallback(async () => {
    const result = await listProjects({ limit: MAX_PAGE_LIMIT, offset: 0 });
    setProjects(result.items);
  }, []);

  const loadUpcoming = useCallback(async () => {
    try {
      await upcomingSoft.run(async () => {
        const result = await listSchedulesUpcoming({
          horizonHours,
          projectId: projectFilter || undefined,
          enabled: enabledFilter,
          q: query || undefined,
        });
        setUpcoming(result);
      });
    } catch {
      // ignore
    }
  }, [horizonHours, projectFilter, enabledFilter, query, upcomingSoft.run]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadUpcoming();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, enabledFilter, query, horizonHours]);

  useBindStoreRefresh(
    useCatalogStore.getState(),
    useCallback(async () => {
      await Promise.all([table.load(), loadProjects(), loadUpcoming()]);
    }, [table.load, loadProjects, loadUpcoming]),
  );

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (projectFilter) next.set("projectId", projectFilter);
    else next.delete("projectId");
    if (agentFilter) next.set("agentId", agentFilter);
    else next.delete("agentId");
    if (query) next.set("q", query);
    else next.delete("q");
    if (enabledFilter !== "enabled") next.set("enabled", enabledFilter);
    else next.delete("enabled");
    if (table.sort !== "createdAt" || table.order !== "asc") {
      next.set("sort", table.sort);
      next.set("order", table.order);
    } else {
      next.delete("sort");
      next.delete("order");
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, agentFilter, query, enabledFilter, table.sort, table.order]);

  async function toggle(schedule: Schedule) {
    setBusyId(schedule.id);
    setPageError("");
    try {
      if (schedule.enabled) await disableSchedule(schedule.id);
      else await enableSchedule(schedule.id);
      await table.load();
      await loadUpcoming();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  function cronPrimary(schedule: Schedule): string {
    return schedule.cronDescription?.trim() || schedule.cronExpr;
  }

  const projectOptions = [
    { value: "", label: "All projects" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div>
      <PageHeader
        title="Schedules"
        subtitle="Cron is a suggested start — the run queue admits under the global concurrency cap"
      />

      {pageError || table.error ? (
        <AppSectionMessage appearance="error">{pageError || table.error}</AppSectionMessage>
      ) : null}

      <section className="panel mb-7">
        <div className="panel-header schedules-panel-header">
          <span>Future runs</span>
          <div className="filter-bar schedules-toolbar">
            <div style={{ minWidth: 180 }}>
              <Select
                inputId="sched-chart-project"
                aria-label="Project"
                value={projectOptions.find((o) => o.value === projectFilter)}
                options={projectOptions}
                onChange={(opt) => setProjectFilter(opt?.value ?? "")}
                isSearchable={false}
              />
            </div>
            <SegmentedControl
              ariaLabel="Schedule enabled status"
              items={ENABLED_OPTIONS}
              value={enabledFilter}
              onChange={setEnabledFilter}
            />
            <Textfield
              id="sched-chart-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Name, agent, cron…"
              aria-label="Search"
            />
            <div style={{ minWidth: 140 }}>
              <Select
                inputId="sched-horizon"
                aria-label="Horizon"
                value={HORIZON_OPTIONS.find((o) => o.value === horizonHours)}
                options={HORIZON_OPTIONS}
                onChange={(opt) => opt && setHorizonHours(opt.value)}
                isSearchable={false}
              />
            </div>
          </div>
        </div>
        <div className="panel-body">
          {upcomingSoft.loading && !upcoming ? (
            <div className="muted">Loading timeline…</div>
          ) : upcoming?.schedules ? (
            <SchedulesTimelineChart
              schedules={upcoming.schedules}
              from={upcoming.from}
              to={upcoming.to}
            />
          ) : (
            <div className="muted">Could not load upcoming fires.</div>
          )}
          <div className="muted text-sm mt-2">
            Drag to pan · scroll to zoom · colors match each schedule
          </div>
        </div>
      </section>

      <div className="filter-bar mb-7">
        <div style={{ minWidth: 180 }}>
          <Select
            inputId="sched-table-project"
            aria-label="Project"
            value={projectOptions.find((o) => o.value === projectFilter)}
            options={projectOptions}
            onChange={(opt) => setProjectFilter(opt?.value ?? "")}
            isSearchable={false}
          />
        </div>
        <SegmentedControl
          ariaLabel="Schedule enabled status"
          items={ENABLED_OPTIONS}
          value={enabledFilter}
          onChange={setEnabledFilter}
        />
        <Textfield
          id="sched-table-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Name, agent, cron…"
          aria-label="Search"
        />
      </div>

      {table.loading && table.items.length === 0 ? (
        <div className="empty">Loading schedules…</div>
      ) : table.total === 0 ? (
        <div className="empty">
          {query || projectFilter || agentFilter || enabledFilter !== "all"
            ? "No schedules match these filters"
            : "No schedules yet — define them in gojo.yaml and Sync the project"}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <SortableTh
                    column="name"
                    label="Name"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <th>Agent</th>
                  <SortableTh
                    column="projectName"
                    label="Project"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <SortableTh
                    column="cronExpr"
                    label="Schedule"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <th>Overlap</th>
                  <SortableTh
                    column="enabled"
                    label="Status"
                    sort={table.sort}
                    order={table.order}
                    defaultOrder="desc"
                    onSort={table.setSort}
                  />
                  <SortableTh
                    column="nextRunAt"
                    label="Next"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <th>Failures</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {table.items.map((schedule) => (
                  <tr key={schedule.id}>
                    <td>
                      <div className="entity-name">{schedule.name}</div>
                      <div className="mono muted text-sm">
                        {schedule.id.slice(0, 10)}…
                      </div>
                    </td>
                    <td>
                      <div>{schedule.agentName || "—"}</div>
                      <div className="mono muted text-sm">
                        {schedule.agentId.slice(0, 10)}…
                      </div>
                    </td>
                    <td>{schedule.projectName || "—"}</td>
                    <td>
                      <div>{cronPrimary(schedule)}</div>
                      <div className="mono muted text-sm">
                        {schedule.cronExpr} · {formatTimezoneLabel(schedule.timezone)}
                      </div>
                    </td>
                    <td className="mono muted text-sm">
                      {schedule.overlapPolicy || "skip"}
                    </td>
                    <td>
                      <EnabledBadge enabled={schedule.enabled} />
                    </td>
                    <td>
                      {schedule.enabled && schedule.nextRunAt ? (
                        <>
                          <div>
                            {formatRelativeNextRun(
                              schedule.nextRunAt,
                              Date.now(),
                              schedule.timezone,
                            )}
                          </div>
                          <div className="mono muted text-sm">
                            {formatAbsoluteInZone(schedule.nextRunAt, schedule.timezone)}
                          </div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="mono">{schedule.consecutiveFailures}</td>
                    <td>
                      <AppButton
                        size="sm"
                        loading={busyId === schedule.id}
                        loadingLabel="Working…"
                        onClick={() => void toggle(schedule)}
                        iconBefore={<Power size={12} />}
                      >
                        {schedule.enabled ? "Disable" : "Enable"}
                      </AppButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TablePager
            page={table.page}
            pageCount={table.pages}
            rangeLabel={table.rangeLabel}
            total={table.total}
            onPageChange={table.setPage}
            loading={table.loading}
          />
        </>
      )}

    </div>
  );
}
