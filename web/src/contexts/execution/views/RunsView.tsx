import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppSelect as Select } from "@/ui/AppSelect";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { Play } from "lucide-react";

import { getQueue } from "@/contexts/scheduling/contract";
import { listRuns, useExecutionStore } from "@/contexts/execution/contract";
import {
  listAgents,
  listProjects,
  runAgent,
  useCatalogStore,
} from "@/contexts/catalog/contract";
import { AppButton } from "@/ui/AppButton";
import { PageHeader } from "@/ui/PageHeader";
import { SortableTh } from "@/ui/SortableTh";
import { StateBadge } from "@/ui/StateBadge";
import { TablePager } from "@/ui/TablePager";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useServerTable } from "@/platform/useServerTable";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import type { Order } from "@/platform/useClientPager";
import type { Agent, Project } from "@/contexts/catalog/types";

const RUN_SORT_ALLOWED = [
  "createdAt",
  "finishedAt",
  "state",
  "trigger",
  "agentName",
  "projectName",
] as const;

const RUN_STATES = [
  "Scheduled",
  "Queued",
  "Preparing",
  "Running",
  "Validating",
  "AwaitingApproval",
  "Integrating",
  "Reporting",
  "Succeeded",
  "Failed",
  "Canceled",
  "TimedOut",
  "Skipped",
  "Superseded",
  "Abandoned",
  "Blocked",
  "Conflict",
  "InfrastructureFailure",
] as const;

const TRIGGERS = ["schedule", "api", "manual", "heal"] as const;

/** Sentinel for "no filter" — empty string breaks Atlaskit Select value rendering. */
const ALL = "all";

function fmtTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function RunsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const initialSort = useMemo(() => {
    const v = searchParams.get("sort") ?? "";
    return (RUN_SORT_ALLOWED as readonly string[]).includes(v) ? v : "createdAt";
  }, [searchParams]);
  const initialOrder: Order = searchParams.get("order") === "asc" ? "asc" : "desc";

  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projectFilter, setProjectFilter] = useState(searchParams.get("projectId") || ALL);
  const [agentFilter, setAgentFilter] = useState(searchParams.get("agentId") || ALL);
  const [stateFilter, setStateFilter] = useState(searchParams.get("state") || ALL);
  const [triggerFilter, setTriggerFilter] = useState(searchParams.get("trigger") || ALL);
  const [fromFilter] = useState(searchParams.get("from") ?? "");
  const [toFilter] = useState(searchParams.get("to") ?? "");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [enqueueBusy, setEnqueueBusy] = useState(false);
  const [queuePositions, setQueuePositions] = useState<Record<string, number>>({});
  const [pageError, setPageError] = useState("");

  const table = useServerTable({
    defaultSort: initialSort,
    defaultOrder: initialOrder,
    watchSources: [
      projectFilter,
      agentFilter,
      stateFilter,
      triggerFilter,
      fromFilter,
      toFilter,
      query,
    ],
    fetchPage: ({ limit, offset, sort, order }) =>
      listRuns({
        limit,
        offset,
        sort,
        order,
        projectId: projectFilter === ALL ? undefined : projectFilter,
        agentId: agentFilter === ALL ? undefined : agentFilter,
        state: stateFilter === ALL ? undefined : stateFilter,
        trigger: triggerFilter === ALL ? undefined : triggerFilter,
        from: fromFilter || undefined,
        to: toFilter || undefined,
        q: query || undefined,
      }),
  });

  const selectedAgent =
    agentFilter !== ALL ? agents.find((a) => a.id === agentFilter) ?? null : null;
  const canEnqueue =
    agentFilter !== ALL ? (selectedAgent ? selectedAgent.enabled : true) : false;

  const loadProjects = useCallback(async () => {
    const result = await listProjects({ limit: MAX_PAGE_LIMIT, offset: 0 });
    setProjects(result.items);
  }, []);

  const loadAgentOptions = useCallback(async () => {
    const result = await listAgents({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
      projectId: projectFilter === ALL ? undefined : projectFilter,
    });
    let next = result.items;
    if (agentFilter !== ALL && !result.items.some((a) => a.id === agentFilter)) {
      const orphan = await listAgents({ limit: 1, offset: 0, q: agentFilter });
      const match = orphan.items.find((a) => a.id === agentFilter);
      if (match) next = [match, ...result.items];
    }
    setAgents(next);
  }, [projectFilter, agentFilter]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);
  useEffect(() => {
    void loadAgentOptions();
  }, [loadAgentOptions]);

  const loadQueuePositions = useCallback(async () => {
    try {
      const snap = await getQueue({ limit: MAX_PAGE_LIMIT, offset: 0 });
      const next: Record<string, number> = {};
      for (const item of snap.waiting) next[item.runId] = item.position;
      setQueuePositions(next);
    } catch {
      setQueuePositions({});
    }
  }, []);

  useBindStoreRefresh(
    useExecutionStore.getState(),
    useCallback(async () => {
      await Promise.all([table.load(), loadQueuePositions()]);
    }, [table.load, loadQueuePositions]),
  );
  useBindStoreRefresh(
    useCatalogStore.getState(),
    useCallback(async () => {
      await Promise.all([loadProjects(), loadAgentOptions()]);
    }, [loadProjects, loadAgentOptions]),
  );

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (projectFilter !== ALL) next.set("projectId", projectFilter);
    else next.delete("projectId");
    if (agentFilter !== ALL) next.set("agentId", agentFilter);
    else next.delete("agentId");
    if (stateFilter !== ALL) next.set("state", stateFilter);
    else next.delete("state");
    if (triggerFilter !== ALL) next.set("trigger", triggerFilter);
    else next.delete("trigger");
    if (query) next.set("q", query);
    else next.delete("q");
    if (table.sort !== "createdAt" || table.order !== "desc") {
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
  }, [projectFilter, agentFilter, stateFilter, triggerFilter, query, table.sort, table.order]);

  async function enqueueSelectedAgent() {
    if (agentFilter === ALL || !canEnqueue) return;
    setEnqueueBusy(true);
    setPageError("");
    try {
      const run = await runAgent(agentFilter);
      navigate(`/runs/${run.id}`);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to enqueue run");
    } finally {
      setEnqueueBusy(false);
    }
  }

  const projectOptions = [
    { value: ALL, label: "All projects" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];
  const agentOptions = [
    { value: ALL, label: "All agents" },
    ...agents.map((a) => ({
      value: a.id,
      label: a.name + (a.projectName ? ` (${a.projectName})` : ""),
    })),
  ];
  const stateOptions = [
    { value: ALL, label: "All states" },
    ...RUN_STATES.map((s) => ({ value: s, label: s })),
  ];
  const triggerOptions = [
    { value: ALL, label: "All triggers" },
    ...TRIGGERS.map((t) => ({ value: t, label: t })),
  ];

  return (
    <div>
      <PageHeader
        title="Runs"
        subtitle={
          selectedAgent ? (
            <>
              {selectedAgent.name}
              {selectedAgent.projectName ? (
                <span> · {selectedAgent.projectName}</span>
              ) : null}
            </>
          ) : (
            "Execution history"
          )
        }
        actions={
          agentFilter !== ALL ? (
            <AppButton
              variant="primary"
              loading={enqueueBusy}
              loadingLabel="Enqueueing…"
              disabled={!canEnqueue}
              title={
                selectedAgent && !selectedAgent.enabled ? "Agent is disabled" : undefined
              }
              onClick={() => void enqueueSelectedAgent()}
              iconBefore={<Play size={16} />}
            >
              Enqueue run
            </AppButton>
          ) : null
        }
      />

      {pageError || table.error ? (
        <div className="alert alert-error">{pageError || table.error}</div>
      ) : null}

      <div className="inline-form mb-7 task-filters">
        <div className="field">
          <label htmlFor="run-project-filter">Project</label>
          <Select
            inputId="run-project-filter"
            value={projectOptions.find((o) => o.value === projectFilter) ?? projectOptions[0]}
            options={projectOptions}
            onChange={(opt) => setProjectFilter(opt?.value ?? ALL)}
            isSearchable={false}
          />
        </div>
        <div className="field">
          <label htmlFor="run-agent-filter">Agent</label>
          <Select
            inputId="run-agent-filter"
            value={agentOptions.find((o) => o.value === agentFilter) ?? agentOptions[0]}
            options={agentOptions}
            onChange={(opt) => setAgentFilter(opt?.value ?? ALL)}
            isSearchable
          />
        </div>
        <div className="field">
          <label htmlFor="run-state-filter">State</label>
          <Select
            inputId="run-state-filter"
            value={stateOptions.find((o) => o.value === stateFilter) ?? stateOptions[0]}
            options={stateOptions}
            onChange={(opt) => setStateFilter(opt?.value ?? ALL)}
            isSearchable={false}
          />
        </div>
        <div className="field">
          <label htmlFor="run-trigger-filter">Trigger</label>
          <Select
            inputId="run-trigger-filter"
            value={triggerOptions.find((o) => o.value === triggerFilter) ?? triggerOptions[0]}
            options={triggerOptions}
            onChange={(opt) => setTriggerFilter(opt?.value ?? ALL)}
            isSearchable={false}
          />
        </div>
        <div className="field flex-2">
          <label htmlFor="run-search">Search</label>
          <Textfield
            id="run-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Agent, project, run id…"
          />
        </div>
        <div className="field task-filter-count">
          <label>&nbsp;</label>
          <span className="muted">
            {table.total} run{table.total === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {table.loading && table.items.length === 0 ? (
        <div className="empty">Loading runs…</div>
      ) : table.total === 0 ? (
        <div className="empty">
          {query ||
          projectFilter !== ALL ||
          agentFilter !== ALL ||
          stateFilter !== ALL ||
          triggerFilter !== ALL
            ? "No runs match these filters"
            : "No runs yet — trigger an agent or wait for the next schedule"}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <SortableTh
                    column="agentName"
                    label="Agent"
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
                  <SortableTh
                    column="state"
                    label="State"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <SortableTh
                    column="trigger"
                    label="Trigger"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <SortableTh
                    column="createdAt"
                    label="Created"
                    sort={table.sort}
                    order={table.order}
                    defaultOrder="desc"
                    onSort={table.setSort}
                  />
                  <SortableTh
                    column="finishedAt"
                    label="Finished"
                    sort={table.sort}
                    order={table.order}
                    defaultOrder="desc"
                    onSort={table.setSort}
                  />
                </tr>
              </thead>
              <tbody>
                {table.items.map((run) => {
                  const agentQ = new URLSearchParams({
                    projectId: run.projectId,
                    q: run.agentId,
                    enabled: "all",
                  });
                  return (
                    <tr key={run.id}>
                      <td>
                        <Link to={`/agents?${agentQ.toString()}`} className="entity-name">
                          {run.agentName || "Unknown agent"}
                        </Link>
                      </td>
                      <td>{run.projectName || "Unknown project"}</td>
                      <td>
                        <Link to={`/runs/${run.id}`}>
                          <StateBadge state={run.state} />
                        </Link>
                        {(run.state === "Queued" || run.state === "Scheduled") &&
                        queuePositions[run.id] ? (
                          <div className="mono muted text-sm">
                            queue #{queuePositions[run.id]}
                          </div>
                        ) : null}
                      </td>
                      <td className="mono">{run.trigger}</td>
                      <td className="mono muted">{fmtTime(run.createdAt)}</td>
                      <td className="mono muted">{fmtTime(run.finishedAt)}</td>
                    </tr>
                  );
                })}
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
