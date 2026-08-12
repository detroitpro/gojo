import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppSelect as Select } from "@/ui/AppSelect";
import { GitCommitHorizontal, GitMerge, GitPullRequest, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { listIntegrations, useDeliveryStore } from "@/contexts/delivery/contract";
import { listProjects } from "@/contexts/catalog/contract";
import { PageHeader } from "@/ui/PageHeader";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { IntegrationStatusBadge } from "@/ui/status/IntegrationStatusBadge";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useServerTable } from "@/platform/useServerTable";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import {
  defaultIntegrationSort,
  type IntegrationListStatus,
} from "@gojo/contracts/types";
import type { Order } from "@/platform/useClientPager";
import type { Project } from "@/contexts/catalog/types";

const INTEGRATION_SORT_ALLOWED = [
  "activityAt",
  "openedAt",
  "mergedAt",
  "createdAt",
  "projectName",
  "agentName",
  "prNumber",
] as const;

const STATUSES: {
  value: IntegrationListStatus;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "open", label: "Open", icon: GitPullRequest },
  { value: "merged", label: "Merged", icon: GitMerge },
  { value: "committed", label: "Commits", icon: GitCommitHorizontal },
];

type StatusCounts = Record<IntegrationListStatus, number | null>;

function parseStatus(value: string): IntegrationListStatus {
  if (value === "open" || value === "merged" || value === "committed" || value === "all") {
    return value;
  }
  return "all";
}

function shortSha(sha: string | null): string {
  if (!sha) return "—";
  return sha.length > 12 ? `${sha.slice(0, 7)}…` : sha;
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function emptyLabel(status: IntegrationListStatus): string {
  if (status === "all") return "No open or merged integrations in this filter";
  if (status === "committed") return "No commit-only integrations in this filter";
  return `No ${status} integrations in this filter`;
}

export function IntegrationsView() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [statusFilter, setStatusFilter] = useState<IntegrationListStatus>(() =>
    parseStatus(searchParams.get("status") ?? ""),
  );
  const [projectFilter, setProjectFilter] = useState(searchParams.get("projectId") ?? "");
  const [fromFilter] = useState(searchParams.get("from") ?? "");
  const [toFilter] = useState(searchParams.get("to") ?? "");

  const initialSort = useMemo(() => {
    const v = searchParams.get("sort") ?? "";
    if ((INTEGRATION_SORT_ALLOWED as readonly string[]).includes(v)) return v;
    return defaultIntegrationSort(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initialOrder: Order = searchParams.get("order") === "asc" ? "asc" : "desc";

  const [projects, setProjects] = useState<Project[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({
    all: null,
    open: null,
    merged: null,
    committed: null,
  });

  const table = useServerTable({
    defaultSort: initialSort,
    defaultOrder: initialOrder,
    watchSources: [statusFilter, projectFilter, fromFilter, toFilter],
    fetchPage: ({ limit, offset, sort, order }) =>
      listIntegrations({
        limit,
        offset,
        sort,
        order,
        status: statusFilter,
        projectId: projectFilter || undefined,
        from: fromFilter || undefined,
        to: toFilter || undefined,
      }),
  });

  const loadProjects = useCallback(async () => {
    const result = await listProjects({ limit: MAX_PAGE_LIMIT, offset: 0 });
    setProjects(result.items);
  }, []);

  const loadCounts = useCallback(async () => {
    const base = {
      limit: 1,
      offset: 0,
      projectId: projectFilter || undefined,
      from: fromFilter || undefined,
      to: toFilter || undefined,
    };
    const [allPage, openPage, mergedPage, committedPage] = await Promise.all([
      listIntegrations({ ...base, status: "all" }).catch(() => null),
      listIntegrations({ ...base, status: "open" }).catch(() => null),
      listIntegrations({ ...base, status: "merged" }).catch(() => null),
      listIntegrations({ ...base, status: "committed" }).catch(() => null),
    ]);
    setStatusCounts({
      all: allPage?.total ?? null,
      open: openPage?.total ?? null,
      merged: mergedPage?.total ?? null,
      committed: committedPage?.total ?? null,
    });
  }, [projectFilter, fromFilter, toFilter]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);
  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  useBindStoreRefresh(useDeliveryStore.getState(), table.load);
  useBindStoreRefresh(useDeliveryStore.getState(), loadProjects);
  useBindStoreRefresh(useDeliveryStore.getState(), loadCounts);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (statusFilter === "all") next.delete("status");
    else next.set("status", statusFilter);
    if (projectFilter) next.set("projectId", projectFilter);
    else next.delete("projectId");
    const defaultSort = defaultIntegrationSort(statusFilter);
    if (table.sort !== defaultSort || table.order !== "desc") {
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
  }, [statusFilter, projectFilter, table.sort, table.order]);

  const statusItems = useMemo(
    () =>
      STATUSES.map((tab) => ({
        value: tab.value,
        label: tab.label,
        icon: <tab.icon size={14} />,
        count: statusCounts[tab.value],
      })),
    [statusCounts],
  );

  const projectOptions = [
    { value: "", label: "All projects" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="Recent open and merged PRs from automation runs"
      />

      {table.error ? <div className="alert alert-error">{table.error}</div> : null}

      <div className="filter-bar mb-7">
        <SegmentedControl
          ariaLabel="Integration status"
          items={statusItems}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <div style={{ minWidth: 200 }}>
          <Select
            inputId="integrations-project"
            aria-label="Project"
            value={projectOptions.find((o) => o.value === projectFilter) ?? projectOptions[0]}
            options={projectOptions}
            onChange={(opt) => setProjectFilter(opt?.value ?? "")}
            isSearchable={false}
          />
        </div>
      </div>

      {table.loading ? (
        <div className="empty">Loading integrations…</div>
      ) : table.items.length === 0 ? (
        <div className="empty">{emptyLabel(statusFilter)}</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <SortableTh
                    column="projectName"
                    label="Project"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <SortableTh
                    column="agentName"
                    label="Agent"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <th>{statusFilter === "committed" ? "Commit" : "PR"}</th>
                  <th>Status</th>
                  {statusFilter !== "committed" ? (
                    <SortableTh
                      column="openedAt"
                      label="Opened"
                      sort={table.sort}
                      order={table.order}
                      onSort={table.setSort}
                    />
                  ) : null}
                  {statusFilter === "merged" || statusFilter === "all" ? (
                    <SortableTh
                      column="mergedAt"
                      label="Merged"
                      sort={table.sort}
                      order={table.order}
                      onSort={table.setSort}
                    />
                  ) : null}
                  {statusFilter === "committed" ? (
                    <SortableTh
                      column="createdAt"
                      label="Run created"
                      sort={table.sort}
                      order={table.order}
                      onSort={table.setSort}
                    />
                  ) : null}
                  <th>Run</th>
                </tr>
              </thead>
              <tbody>
                {table.items.map((row) => (
                  <tr key={row.runId}>
                    <td>{row.projectName ?? row.projectId}</td>
                    <td>{row.agentName ?? row.agentId}</td>
                    <td>
                      {statusFilter === "committed" ? (
                        <span className="mono">{shortSha(row.commitSha)}</span>
                      ) : row.prUrl ? (
                        <a href={row.prUrl} target="_blank" rel="noopener noreferrer">
                          #{row.prNumber ?? "?"}
                        </a>
                      ) : (
                        <>#{row.prNumber ?? "—"}</>
                      )}
                    </td>
                    <td>
                      <IntegrationStatusBadge status={row.status} />
                    </td>
                    {statusFilter !== "committed" ? (
                      <td>{formatWhen(row.openedAt)}</td>
                    ) : null}
                    {statusFilter === "merged" || statusFilter === "all" ? (
                      <td>{formatWhen(row.mergedAt)}</td>
                    ) : null}
                    {statusFilter === "committed" ? (
                      <td>{formatWhen(row.runCreatedAt)}</td>
                    ) : null}
                    <td>
                      <Link to={`/runs/${row.runId}`}>Open run</Link>
                      <span className="muted"> · </span>
                      <Link to="/approvals">Approvals</Link>
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
