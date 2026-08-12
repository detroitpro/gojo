import { useEffect, useMemo, useState } from "react";
import { AppSelect as Select } from "@/ui/AppSelect";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";

import { AppButton } from "@/ui/AppButton";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { TablePager } from "@/ui/TablePager";
import { useClientPager } from "@/platform/useClientPager";
import { fmtDuration, fmtTime } from "@/kernel/format";
import {
  buildActivityItems,
  type ActivityItem,
  type ActivityKind,
} from "@/kernel/run-activity";
import type { PhaseKey } from "@/kernel/run-phases";
import type { RunEvent } from "@/contexts/execution/types";

const PAGE_SIZE = 10;

type SortField = "at" | "kind" | "title";
type Order = "asc" | "desc";

const KIND_OPTIONS: Array<{ value: ActivityKind | "all"; label: string }> = [
  { value: "all", label: "All kinds" },
  { value: "lifecycle", label: "Lifecycle" },
  { value: "agent", label: "Agent" },
  { value: "assistant", label: "Assistant" },
  { value: "tool", label: "Tools" },
  { value: "validation", label: "Validation" },
  { value: "artifact", label: "Artifacts" },
  { value: "error", label: "Errors" },
];

export type RunActivityFeedProps = {
  events: RunEvent[];
  phaseFilter?: PhaseKey | null;
  highlightId?: string | null;
};

export function RunActivityFeed({ events, phaseFilter, highlightId }: RunActivityFeedProps) {
  const [kindFilter, setKindFilter] = useState<ActivityKind | "all">("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<SortField>("at");
  const [order, setOrder] = useState<Order>("desc");

  const allItems = useMemo(() => buildActivityItems(events), [events]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems.filter((item) => {
      if (phaseFilter && item.phase !== phaseFilter) return false;
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (!q) return true;
      if (
        item.title.toLowerCase().includes(q) ||
        (item.detail?.toLowerCase().includes(q) ?? false) ||
        (item.body?.toLowerCase().includes(q) ?? false)
      ) {
        return true;
      }
      return (
        item.tools?.some(
          (tool) =>
            tool.name.toLowerCase().includes(q) ||
            (tool.summary?.toLowerCase().includes(q) ?? false),
        ) ?? false
      );
    });
  }, [allItems, kindFilter, phaseFilter, query]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sort === "at") cmp = a.atMs - b.atMs;
      else if (sort === "kind") cmp = a.kind.localeCompare(b.kind);
      else cmp = a.title.localeCompare(b.title);
      return order === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sort, order]);

  const pager = useClientPager(sorted, PAGE_SIZE);

  useEffect(() => {
    pager.setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseFilter, kindFilter, query, sort, order]);

  useEffect(() => {
    const newest = pager.items.find((row) => row.kind === "assistant" || row.body);
    if (newest && expanded[newest.id] === undefined) {
      setExpanded((prev) => ({ ...prev, [newest.id]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pager.items]);

  useEffect(() => {
    if (!highlightId) return;
    const idx = sorted.findIndex((item) => item.id === highlightId);
    if (idx < 0) return;
    pager.setPage(Math.floor(idx / PAGE_SIZE));
    setExpanded((prev) => ({ ...prev, [highlightId]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, sorted]);

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function statusClass(item: ActivityItem): string {
    return `kind-${item.status ?? "info"}`;
  }

  function toggleSort(next: SortField, first: Order) {
    if (sort === next) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(next);
      setOrder(first);
    }
  }

  const kindValue = KIND_OPTIONS.find((o) => o.value === kindFilter) ?? KIND_OPTIONS[0];

  return (
    <div className="activity-panel">
      <div className="filter-bar activity-filters">
        <div style={{ minWidth: 180 }}>
          <Select
            inputId="activity-kind"
            aria-label="Kind"
            value={kindValue}
            options={KIND_OPTIONS}
            onChange={(opt) => setKindFilter((opt?.value as ActivityKind | "all") ?? "all")}
            isSearchable={false}
          />
        </div>
        <div style={{ minWidth: 220, flex: 1 }}>
          <Textfield
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Filter activity…"
            aria-label="Search"
            type="search"
          />
        </div>
        <span className="muted filter-bar-count">{sorted.length} events</span>
        <SegmentedControl
          ariaLabel="Sort activity"
          value={sort}
          onChange={(next) => {
            const first: Order = next === "at" ? "desc" : "asc";
            toggleSort(next, first);
          }}
          items={[
            {
              value: "at",
              label: `Time${sort === "at" ? (order === "asc" ? " ↑" : " ↓") : ""}`,
            },
            {
              value: "kind",
              label: `Kind${sort === "kind" ? (order === "asc" ? " ↑" : " ↓") : ""}`,
            },
            {
              value: "title",
              label: `Title${sort === "title" ? (order === "asc" ? " ↑" : " ↓") : ""}`,
            },
          ]}
        />
      </div>

      {pager.items.length ? (
        <ul className="activity-feed">
          {pager.items.map((row) => (
            <li
              key={row.id}
              id={`activity-${row.id}`}
              className={`activity-row ${statusClass(row)}${highlightId === row.id ? " highlighted" : ""}`}
            >
              <span className="time">{fmtTime(row.at)}</span>
              <div className="activity-body">
                <div className="activity-title">{row.title}</div>
                {row.detail ? <div className="activity-detail muted">{row.detail}</div> : null}

                {row.body ? (
                  <>
                    <AppButton
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => toggle(row.id)}
                    >
                      {expanded[row.id] ? "Hide message" : "Show message"}
                    </AppButton>
                    {expanded[row.id] ? (
                      <pre className="pre-block mt-2 activity-assistant-body">{row.body}</pre>
                    ) : null}
                  </>
                ) : null}

                {row.tools?.length ? (
                  <>
                    <AppButton
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => toggle(row.id)}
                    >
                      {expanded[row.id]
                        ? "Hide tools"
                        : row.tools.length === 1
                          ? "Show tool"
                          : `Show ${row.tools.length} tools`}
                    </AppButton>
                    {expanded[row.id] ? (
                      <ul className="tool-list mt-2">
                        {row.tools.map((tool) => (
                          <li key={tool.callId} className="tool-list-item">
                            <span className="tool-name mono">{tool.name}</span>
                            <span
                              className={`tool-phase muted${tool.phase === "completed" ? " tool-done" : ""}`}
                            >
                              {tool.phase === "completed" ? "done" : "running"}
                            </span>
                            {tool.summary ? (
                              <span className="tool-summary muted">{tool.summary}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}

                {row.validation ? (
                  <>
                    <div className="activity-meta mono muted">
                      {row.validation.command} · {fmtDuration(row.validation.durationMs)}
                    </div>
                    <AppButton
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => toggle(row.id)}
                    >
                      {expanded[row.id] ? "Hide output" : "Show output"}
                    </AppButton>
                    {expanded[row.id] ? (
                      <div className="validation-output mt-2">
                        {row.validation.stdout ? (
                          <pre className="pre-block">{row.validation.stdout}</pre>
                        ) : null}
                        {row.validation.stderr ? (
                          <pre className="pre-block pre-stderr">{row.validation.stderr}</pre>
                        ) : null}
                        {!row.validation.stdout && !row.validation.stderr ? (
                          <div className="muted">
                            No stdout/stderr captured for this step.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted">No activity matches this filter.</div>
      )}

      <TablePager
        offset={pager.offset}
        limit={PAGE_SIZE}
        total={sorted.length}
        onPrev={pager.prev}
        onNext={pager.next}
      />
    </div>
  );
}
