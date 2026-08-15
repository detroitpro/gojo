import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppSelect as Select } from "@/ui/AppSelect";

import { listImpactItems, listProjects, useCatalogStore } from "@/contexts/catalog/contract";
import { AppSectionMessage } from "@/ui/AppSectionMessage";
import { PageHeader } from "@/ui/PageHeader";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";
import { UiIcon } from "@/ui/UiIcon";
import { VerificationBadge } from "@/ui/status/VerificationBadge";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useServerTable } from "@/platform/useServerTable";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import {
  IMPACT_CATEGORIES,
  impactCategoryLabel,
  impactCategorySpec,
} from "@/kernel/stat-metrics";
import type { Order } from "@/platform/useClientPager";
import type { Project } from "@/contexts/catalog/types";

const IMPACT_SORT_ALLOWED = [
  "createdAt",
  "category",
  "subject",
  "projectName",
  "agentName",
] as const;

function formatWhen(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function ImpactView() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialSort = useMemo(() => {
    const v = searchParams.get("sort") ?? "";
    return (IMPACT_SORT_ALLOWED as readonly string[]).includes(v) ? v : "createdAt";
  }, [searchParams]);
  const initialOrder: Order = searchParams.get("order") === "asc" ? "asc" : "desc";

  const [projects, setProjects] = useState<Project[]>([]);
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get("category") ?? "");
  const [projectFilter, setProjectFilter] = useState(searchParams.get("projectId") ?? "");
  const [fromFilter, setFromFilter] = useState(searchParams.get("from") ?? "");
  const [toFilter, setToFilter] = useState(searchParams.get("to") ?? "");
  const [rangeFilter, setRangeFilter] = useState(searchParams.get("range") ?? "");

  const table = useServerTable({
    defaultSort: initialSort,
    defaultOrder: initialOrder,
    watchSources: [categoryFilter, projectFilter, fromFilter, toFilter],
    fetchPage: ({ limit, offset, sort, order }) =>
      listImpactItems({
        limit,
        offset,
        sort,
        order,
        category: categoryFilter || undefined,
        projectId: projectFilter || undefined,
        from: fromFilter || undefined,
        to: toFilter || undefined,
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
    if (categoryFilter) next.set("category", categoryFilter);
    else next.delete("category");
    if (projectFilter) next.set("projectId", projectFilter);
    else next.delete("projectId");
    if (fromFilter) next.set("from", fromFilter);
    else next.delete("from");
    if (toFilter) next.set("to", toFilter);
    else next.delete("to");
    if (rangeFilter) next.set("range", rangeFilter);
    else next.delete("range");
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
  }, [categoryFilter, projectFilter, fromFilter, toFilter, rangeFilter, table.sort, table.order]);

  const categoryOptions = [
    { value: "", label: "All categories" },
    ...IMPACT_CATEGORIES.map((c) => ({ value: c, label: impactCategoryLabel(c) })),
  ];
  const projectOptions = [
    { value: "", label: "All projects" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div>
      <PageHeader
        title="Impact"
        subtitle="Individual impact items behind dashboard category totals"
      />

      {table.error ? <AppSectionMessage appearance="error">{table.error}</AppSectionMessage> : null}

      <div className="filter-bar mb-7">
        <div style={{ minWidth: 200 }}>
          <Select
            inputId="impact-category"
            aria-label="Category"
            value={categoryOptions.find((o) => o.value === categoryFilter) ?? categoryOptions[0]}
            options={categoryOptions}
            onChange={(opt) => setCategoryFilter(opt?.value ?? "")}
            isSearchable={false}
          />
        </div>
        <div style={{ minWidth: 200 }}>
          <Select
            inputId="impact-project"
            aria-label="Project"
            value={projectOptions.find((o) => o.value === projectFilter) ?? projectOptions[0]}
            options={projectOptions}
            onChange={(opt) => setProjectFilter(opt?.value ?? "")}
            isSearchable={false}
          />
        </div>
        {/* keep from/to and range URL round-trip capability */}
        {fromFilter || toFilter || rangeFilter ? (
          <span className="muted text-sm">
            {fromFilter ? <>from {fromFilter} </> : null}
            {toFilter ? <>to {toFilter} </> : null}
            {rangeFilter ? <>· {rangeFilter}</> : null}
          </span>
        ) : null}
        <button
          type="button"
          style={{ display: "none" }}
          onClick={() => {
            setFromFilter("");
            setToFilter("");
            setRangeFilter("");
          }}
        />
      </div>

      {table.loading ? (
        <div className="empty">Loading impact items…</div>
      ) : table.items.length === 0 ? (
        <div className="empty">No impact items match this filter</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <SortableTh
                    column="category"
                    label="Category"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <SortableTh
                    column="subject"
                    label="Subject"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <th>Summary</th>
                  <th>Verification</th>
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
                  <SortableTh
                    column="createdAt"
                    label="Created"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <th>Run</th>
                </tr>
              </thead>
              <tbody>
                {table.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="inline-icon-label">
                        <UiIcon icon={impactCategorySpec(item.category).icon} size={14} />
                        {impactCategoryLabel(item.category)}
                      </span>
                    </td>
                    <td>{item.subject}</td>
                    <td className="muted">{item.summary}</td>
                    <td>
                      <VerificationBadge verification={item.verification} />
                    </td>
                    <td>{item.projectName}</td>
                    <td>{item.agentName}</td>
                    <td>{formatWhen(item.createdAt)}</td>
                    <td>
                      <Link to={`/runs/${item.runId}`}>Open run</Link>
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
