import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppSelect as Select } from "@/ui/AppSelect";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";

import {
  disableAgent,
  enableAgent,
  listAgents,
  listProjects,
  runAgent,
  useCatalogStore,
} from "@/contexts/catalog/contract";
import { ActionMenu, type ActionMenuItem } from "@/ui/ActionMenu";
import { AppSectionMessage } from "@/ui/AppSectionMessage";
import { PageHeader } from "@/ui/PageHeader";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { EnabledBadge } from "@/ui/status/EnabledBadge";
import { RunHistoryStrip } from "@/ui/RunHistoryStrip";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useServerTable } from "@/platform/useServerTable";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import { formatRunSuccessRate } from "@/kernel/run-success-rate";
import type { Order } from "@/platform/useClientPager";
import type { Agent, Project } from "@/contexts/catalog/types";

const AGENT_SORT_ALLOWED = [
  "name",
  "projectName",
  "enabled",
  "createdAt",
  "lastRunAt",
  "successRate",
] as const;

type EnabledFilter = "all" | "enabled" | "disabled";
const ENABLED_OPTIONS: Array<{ value: EnabledFilter; label: string }> = [
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
  { value: "all", label: "All" },
];

export function AgentsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const initialSort = useMemo(() => {
    const v = searchParams.get("sort") ?? "";
    return (AGENT_SORT_ALLOWED as readonly string[]).includes(v) ? v : "name";
  }, [searchParams]);
  const initialOrder: Order = searchParams.get("order") === "desc" ? "desc" : "asc";
  const initialEnabled: EnabledFilter =
    (searchParams.get("enabled") as EnabledFilter) === "all" ||
    (searchParams.get("enabled") as EnabledFilter) === "disabled"
      ? (searchParams.get("enabled") as EnabledFilter)
      : "enabled";

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState(searchParams.get("projectId") || "all");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>(initialEnabled);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");

  const table = useServerTable<Agent>({
    defaultSort: initialSort,
    defaultOrder: initialOrder,
    watchSources: [projectFilter, enabledFilter, query],
    fetchPage: ({ limit, offset, sort, order }) =>
      listAgents({
        limit,
        offset,
        sort,
        order,
        projectId: projectFilter === "all" ? undefined : projectFilter || undefined,
        enabled: enabledFilter,
        q: query || undefined,
      }),
  });

  const loadProjects = useCallback(async () => {
    const result = await listProjects({ limit: MAX_PAGE_LIMIT, offset: 0 });
    setProjects(result.items);
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useBindStoreRefresh(useCatalogStore.getState(), table.load);
  useBindStoreRefresh(useCatalogStore.getState(), loadProjects);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (projectFilter && projectFilter !== "all") next.set("projectId", projectFilter);
    else next.delete("projectId");
    if (query) next.set("q", query);
    else next.delete("q");
    if (enabledFilter !== "enabled") next.set("enabled", enabledFilter);
    else next.delete("enabled");
    if (table.sort !== "name" || table.order !== "asc") {
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
  }, [projectFilter, query, enabledFilter, table.sort, table.order]);

  function rowActions(agent: Agent): ActionMenuItem[] {
    const runsQ = new URLSearchParams({ agentId: agent.id });
    if (agent.projectId) runsQ.set("projectId", agent.projectId);
    const schedulesQ = new URLSearchParams({ agentId: agent.id, enabled: "all" });
    if (agent.projectId) schedulesQ.set("projectId", agent.projectId);
    return [
      { id: "open", label: "Open", to: `/agents/${agent.id}` },
      {
        id: "run",
        label: "Run now",
        disabled: busyId === agent.id || !agent.enabled,
      },
      { id: "view-runs", label: "View runs", to: `/runs?${runsQ.toString()}` },
      {
        id: "view-schedules",
        label: "View schedules",
        to: `/schedules?${schedulesQ.toString()}`,
      },
      {
        id: "toggle-enabled",
        label: agent.enabled ? "Disable" : "Enable",
        disabled: busyId === agent.id,
      },
    ];
  }

  async function runNow(agent: Agent) {
    setBusyId(agent.id);
    setPageError("");
    try {
      const run = await runAgent(agent.id);
      navigate(`/runs/${run.id}`);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleEnabled(agent: Agent) {
    setBusyId(agent.id);
    setPageError("");
    try {
      if (agent.enabled) await disableAgent(agent.id);
      else await enableAgent(agent.id);
      await table.load();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to update agent");
    } finally {
      setBusyId(null);
    }
  }

  function onAction(agent: Agent, actionId: string) {
    if (actionId === "run") void runNow(agent);
    else if (actionId === "toggle-enabled") void toggleEnabled(agent);
  }

  const projectOptions = [
    { value: "all", label: "All projects" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div>
      <PageHeader
        title="Agents"
        subtitle="Manifest-synced and API-created agents across all projects"
      />

      {pageError || table.error ? (
        <AppSectionMessage appearance="error">{pageError || table.error}</AppSectionMessage>
      ) : null}

      <div className="inline-form mb-7 task-filters">
        <div className="field">
          <label htmlFor="project-filter">Project</label>
          <Select
            inputId="project-filter"
            value={projectOptions.find((o) => o.value === projectFilter) ?? projectOptions[0]}
            options={projectOptions}
            onChange={(opt) => setProjectFilter(opt?.value ?? "all")}
            isSearchable={false}
          />
        </div>
        <div className="field">
          <label>Enabled</label>
          <SegmentedControl
            ariaLabel="Enabled"
            items={ENABLED_OPTIONS}
            value={enabledFilter}
            onChange={setEnabledFilter}
          />
        </div>
        <div className="field flex-2">
          <label htmlFor="agent-search">Search</label>
          <Textfield
            id="agent-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Name, description, project…"
          />
        </div>
        <div className="field task-filter-count">
          <label>&nbsp;</label>
          <span className="muted">
            {table.total} agent{table.total === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {table.loading && table.items.length === 0 ? (
        <div className="empty">Loading agents…</div>
      ) : projects.length === 0 ? (
        <div className="empty">Add a project first, then Sync its gojo.yaml</div>
      ) : table.total === 0 ? (
        <div className="empty">
          {query || projectFilter !== "all" || enabledFilter !== "all"
            ? "No agents match these filters"
            : "No agents yet — Sync a project manifest to pull agents from gojo.yaml"}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data tasks-table">
              <thead>
                <tr>
                  <SortableTh
                    column="name"
                    label="Name"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <SortableTh
                    column="projectName"
                    label="Project"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <th className="tasks-col-runs">Recent runs</th>
                  <SortableTh
                    column="successRate"
                    label="Success"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <SortableTh
                    column="enabled"
                    label="Enabled"
                    sort={table.sort}
                    order={table.order}
                    defaultOrder="desc"
                    onSort={table.setSort}
                  />
                  <th>Profile</th>
                  <SortableTh
                    column="createdAt"
                    label="Created"
                    sort={table.sort}
                    order={table.order}
                    defaultOrder="desc"
                    onSort={table.setSort}
                  />
                  <th />
                </tr>
              </thead>
              <tbody>
                {table.items.map((agent) => (
                  <tr key={agent.id}>
                    <td>
                      <Link to={`/agents/${agent.id}`} className="entity-name">
                        {agent.name}
                      </Link>
                      {agent.description ? (
                        <div className="muted text-sm">{agent.description}</div>
                      ) : null}
                    </td>
                    <td>{agent.projectName || "—"}</td>
                    <td className="tasks-col-runs">
                      <RunHistoryStrip runs={agent.recentRuns ?? []} />
                    </td>
                    <td className="tasks-col-rate mono">
                      {formatRunSuccessRate(agent.recentRuns ?? [])}
                    </td>
                    <td>
                      <EnabledBadge enabled={agent.enabled} />
                    </td>
                    <td>{agent.profileName || "—"}</td>
                    <td className="mono muted">
                      {new Date(agent.createdAt).toLocaleString()}
                    </td>
                    <td className="actions-cell">
                      <ActionMenu
                        items={rowActions(agent)}
                        disabled={busyId === agent.id}
                        label={`Actions for ${agent.name}`}
                        onSelect={(id) => onAction(agent, id)}
                      />
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
