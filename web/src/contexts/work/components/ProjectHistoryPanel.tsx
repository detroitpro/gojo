import { useCallback, useEffect, useMemo, useState } from "react";

import { listImpactItems } from "@/contexts/catalog/contract";
import {
  listProjectSources,
  listProjectWork,
  useWorkStore,
} from "@/contexts/work/contract";
import type { ProjectSource, WorkItem } from "@/contexts/work/types";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  pageCount,
  rangeLabel as formatRangeLabel,
} from "@/kernel/pagination";
import {
  collapseHistoryForOverview,
  groupChangesByDay,
  presentCompletedWork,
} from "@/kernel/project-overview";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { ChangeFeed } from "@/ui/ChangeFeed";
import { TablePager } from "@/ui/TablePager";

function resolveSourceLabel(
  item: WorkItem,
  sourceNames: Map<string, string>,
): string {
  if (item.sourceId) return sourceNames.get(item.sourceId) ?? item.sourceId;
  return item.provenance === "gojo-agent" ? "gojo" : "local";
}

export function ProjectHistoryPanel({ projectId }: { projectId: string }) {
  const [historyItems, setHistoryItems] = useState<WorkItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [projectSources, setProjectSources] = useState<ProjectSource[]>([]);
  const [impactByRun, setImpactByRun] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const limit = DEFAULT_PAGE_LIMIT;

  const sourceNames = useMemo(
    () => new Map(projectSources.map((source) => [source.id, source.displayName])),
    [projectSources],
  );

  const groups = useMemo(() => {
    const presentations = collapseHistoryForOverview(historyItems).map((item) =>
      presentCompletedWork(item, Date.now(), {
        sourceLabel: resolveSourceLabel(item, sourceNames),
      }),
    );
    return groupChangesByDay(presentations);
  }, [historyItems, sourceNames]);

  const pages = pageCount(historyTotal, limit);
  const rangeLabel = formatRangeLabel(historyTotal, limit, (page - 1) * limit);

  const loadHistory = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const [history, sources, impact] = await Promise.all([
        listProjectWork(projectId, {
          limit,
          offset,
          history: true,
        }),
        listProjectSources(projectId),
        listImpactItems({
          projectId,
          limit: MAX_PAGE_LIMIT,
          offset: 0,
        }).catch(() => ({ items: [] as Array<{ runId: string; category: string }> })),
      ]);
      setHistoryItems(history.items);
      setHistoryTotal(history.total);
      setProjectSources(sources);
      const next: Record<string, string[]> = {};
      for (const row of impact.items) {
        const existing = next[row.runId] ?? [];
        if (!existing.includes(row.category)) existing.push(row.category);
        next[row.runId] = existing;
      }
      setImpactByRun(next);
      const maxPage = pageCount(history.total, limit);
      if (page > maxPage) setPage(maxPage);
    } catch (err) {
      setHistoryItems([]);
      setHistoryTotal(0);
      setProjectSources([]);
      setImpactByRun({});
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [projectId, page, limit]);

  useEffect(() => {
    setPage(1);
    setHistoryItems([]);
    setHistoryTotal(0);
    setImpactByRun({});
    setError(null);
  }, [projectId]);

  useBindStoreRefresh(useWorkStore.getState(), loadHistory);

  return (
    <section className="recent-activity panel" aria-labelledby="project-history-heading">
      <div className="panel-header recent-activity__header">
        <div className="recent-activity__heading">
          <h2 id="project-history-heading">History</h2>
          <span className="recent-activity__counts">
            {historyTotal} completed change{historyTotal === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="panel-body">
        <ChangeFeed
          variant="detailed"
          groups={groups}
          impactByRun={impactByRun}
          loading={loading}
          error={error}
          emptyMessage="No completed changes yet."
          emptyHint="When agents complete runs or merge delivery work, outcomes will appear here."
          loadingMessage="Loading history…"
          historyProjectId={null}
          onRetry={() => void loadHistory()}
          footer={
            historyTotal > 0 ? (
              <div className="change-feed__footer">
                <TablePager
                  page={page}
                  pageCount={pages}
                  rangeLabel={rangeLabel}
                  total={historyTotal}
                  onPageChange={setPage}
                />
              </div>
            ) : null
          }
        />
      </div>
    </section>
  );
}
