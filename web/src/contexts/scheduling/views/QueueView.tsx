import { useCallback } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";

import { useSchedulingStore } from "@/contexts/scheduling/contract";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { AppButton } from "@/ui/AppButton";
import { PageHeader } from "@/ui/PageHeader";
import { StatGrid } from "@/ui/StatGrid";
import { StatTile } from "@/ui/StatTile";
import { StateBadge } from "@/ui/StateBadge";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";

function fmtTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function QueueView() {
  const policy = useSchedulingStore((s) => s.policy);
  const running = useSchedulingStore((s) => s.running);
  const waiting = useSchedulingStore((s) => s.waiting);
  const counts = useSchedulingStore((s) => s.counts);
  const total = useSchedulingStore((s) => s.total);
  const limit = useSchedulingStore((s) => s.limit);
  const offset = useSchedulingStore((s) => s.offset);
  const loading = useSchedulingStore((s) => s.loading);
  const error = useSchedulingStore((s) => s.error);
  const sort = useSchedulingStore((s) => s.sort);
  const order = useSchedulingStore((s) => s.order);

  const refresh = useCallback(() => useSchedulingStore.getState().load(), []);
  useBindStoreRefresh(useSchedulingStore.getState(), refresh);

  const page = Math.floor(offset / Math.max(1, limit)) + 1;
  const pages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const rangeLabel = (() => {
    if (total === 0) return "0–0 of 0";
    const start = offset + 1;
    const end = Math.min(offset + waiting.length, total);
    return `${start}–${end} of ${total}`;
  })();

  function setSort(column: string) {
    const store = useSchedulingStore.getState();
    if (store.sort === column) {
      void store.load({ order: store.order === "asc" ? "desc" : "asc", offset: 0 });
      return;
    }
    void store.load({ sort: column, order: "asc", offset: 0 });
  }

  function setPage(nextPage: number) {
    void useSchedulingStore.getState().load({ offset: (nextPage - 1) * limit });
  }

  return (
    <div>
      <PageHeader
        title="Queue"
        subtitle="Cron times are suggestions — the dispatcher admits runs under the global concurrency cap"
        actions={
          <AppButton
            loading={loading}
            loadingLabel="Refreshing…"
            onClick={() => void refresh()}
            iconBefore={<RefreshCw size={16} />}
          >
            Refresh
          </AppButton>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}

      {policy ? (
        <StatGrid>
          <StatTile
            metricKey="queue.running"
            value={`${counts.running} / ${policy.maxConcurrentRuns}`}
          />
          <StatTile metricKey="queue.waiting" value={counts.waiting} />
          <StatTile
            metricKey="queue.perProject"
            value={policy.maxConcurrentRunsPerProject}
          />
          <StatTile
            metricKey="queue.stagger"
            value={`${Math.round(policy.minStartIntervalMs / 1000)}s`}
          />
        </StatGrid>
      ) : null}

      <section className="list-section">
        <div className="list-section__header">
          <h2 className="list-section__title">Running now</h2>
          <span className="list-section__meta">{running.length}</span>
        </div>
        {running.length === 0 ? (
          <div className="muted">No runs occupying slots</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Project</th>
                  <th>State</th>
                  <th>Admitted</th>
                </tr>
              </thead>
              <tbody>
                {running.map((item) => (
                  <tr key={item.runId}>
                    <td>
                      <Link to={`/runs/${item.runId}`}>{item.agentName || "—"}</Link>
                    </td>
                    <td>{item.projectName || "—"}</td>
                    <td>
                      <StateBadge state={item.state} />
                    </td>
                    <td className="mono muted text-sm">{fmtTime(item.admittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="list-section">
        <div className="list-section__header">
          <h2 className="list-section__title">Waiting for a slot</h2>
          <span className="list-section__meta">{total}</span>
        </div>
        {loading && waiting.length === 0 ? (
          <div className="muted">Loading…</div>
        ) : total === 0 ? (
          <div className="muted">Queue is empty</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <SortableTh
                      column="position"
                      label="#"
                      sort={sort}
                      order={order}
                      onSort={setSort}
                    />
                    <SortableTh
                      column="agentName"
                      label="Agent"
                      sort={sort}
                      order={order}
                      onSort={setSort}
                    />
                    <SortableTh
                      column="projectName"
                      label="Project"
                      sort={sort}
                      order={order}
                      onSort={setSort}
                    />
                    <SortableTh
                      column="priority"
                      label="Priority"
                      sort={sort}
                      order={order}
                      onSort={setSort}
                    />
                    <SortableTh
                      column="notBeforeAt"
                      label="Suggested start"
                      sort={sort}
                      order={order}
                      onSort={setSort}
                    />
                    <SortableTh
                      column="expiresAt"
                      label="Expires"
                      sort={sort}
                      order={order}
                      onSort={setSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((item) => (
                    <tr key={item.runId}>
                      <td className="mono">{item.position}</td>
                      <td>
                        <Link to={`/runs/${item.runId}`}>{item.agentName || "—"}</Link>
                        <div className="mono muted text-sm">{item.trigger}</div>
                      </td>
                      <td>{item.projectName || "—"}</td>
                      <td className="mono">{item.priority}</td>
                      <td className="mono muted text-sm">{fmtTime(item.notBeforeAt)}</td>
                      <td className="mono muted text-sm">{fmtTime(item.expiresAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePager
              page={page}
              pageCount={pages}
              rangeLabel={rangeLabel}
              total={total}
              onPageChange={setPage}
              loading={loading}
            />
          </>
        )}
      </section>
    </div>
  );
}
