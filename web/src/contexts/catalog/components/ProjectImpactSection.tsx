import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppSelect as Select } from "@/ui/AppSelect";
import { ArrowRight } from "lucide-react";

import {
  getDashboardImpact,
  useOperationsStore,
} from "@/contexts/operations/contract";
import type { DashboardImpact } from "@/contexts/operations/contract";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { AppButton } from "@/ui/AppButton";
import { StatGrid } from "@/ui/StatGrid";
import { StatTile } from "@/ui/StatTile";
import { VerificationBadge } from "@/ui/status/VerificationBadge";
import { compareLabel } from "@/kernel/stat-metrics";

type ImpactRange = "30d" | "90d" | "all";

const RANGE_OPTIONS: Array<{ value: ImpactRange; label: string }> = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "Lifetime" },
];

export type ProjectImpactSectionProps = {
  projectId: string;
  openPrTotal: number;
  mode?: "compact" | "full";
};

export function ProjectImpactSection({
  projectId,
  openPrTotal,
  mode = "full",
}: ProjectImpactSectionProps) {
  const [impact, setImpact] = useState<DashboardImpact | null>(null);
  const [impactRange, setImpactRange] = useState<ImpactRange>("30d");
  const [hiddenAgentIds, setHiddenAgentIds] = useState<Set<string>>(new Set());

  function impactWindowQs(base: Record<string, string> = {}): string {
    const s = new URLSearchParams(base);
    if (projectId) s.set("projectId", projectId);
    if (impact?.window.from) s.set("from", impact.window.from);
    if (impact?.window.to) s.set("to", impact.window.to);
    if (impactRange !== "all") s.set("range", impactRange);
    const str = s.toString();
    return str ? `?${str}` : "";
  }

  const mergedRoute = `/integrations${impactWindowQs({ status: "merged" })}`;
  const commitsRoute = `/integrations${impactWindowQs({ status: "committed" })}`;
  const succeededRunsRoute = `/runs${impactWindowQs({ state: "Succeeded" })}`;
  const deliveryRoute = `/projects/${projectId}/overview#attention`;
  const projectImpactRoute = `/projects/${projectId}/impact`;
  const browseAllRoute = `/impact${impactWindowQs()}`;

  const categoryRoute = (category: string) => `/impact${impactWindowQs({ category })}`;

  const impactAgents = useMemo(() => {
    const items = impact?.recentItems ?? [];
    const byId = new Map<string, string>();
    for (const item of items) {
      if (!byId.has(item.agentId)) byId.set(item.agentId, item.agentName);
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [impact]);

  const visibleImpactItems = useMemo(() => {
    const items = impact?.recentItems ?? [];
    if (hiddenAgentIds.size === 0) return items;
    return items.filter((item) => !hiddenAgentIds.has(item.agentId));
  }, [impact, hiddenAgentIds]);

  function isAgentVisible(agentId: string): boolean {
    return !hiddenAgentIds.has(agentId);
  }

  function toggleAgentVisibility(agentId: string) {
    setHiddenAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  const loadImpact = useCallback(async () => {
    try {
      const next = await getDashboardImpact({ projectId, range: impactRange });
      setImpact(next);
      setHiddenAgentIds((prev) => {
        const known = new Set(
          (next.recentItems ?? []).map((item) => item.agentId),
        );
        const filtered = new Set([...prev].filter((id) => known.has(id)));
        return filtered.size === prev.size ? prev : filtered;
      });
    } catch {
      setImpact(null);
    }
  }, [projectId, impactRange]);

  useEffect(() => {
    setImpact(null);
    setHiddenAgentIds(new Set());
    void loadImpact();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, impactRange]);

  useBindStoreRefresh(useOperationsStore.getState(), loadImpact);

  if (!impact) return null;

  const rangeValue = RANGE_OPTIONS.find((o) => o.value === impactRange) ?? RANGE_OPTIONS[0];
  const impactCompareLbl = compareLabel("previousWindow", impact.range);

  return (
    <section className="panel mb-7">
      <div className="panel-header impact-header">
        <span>Impact</span>
        <div className="impact-header-actions">
          <div style={{ minWidth: 180 }}>
            <Select
              inputId={`project-impact-range-${mode}`}
              aria-label="Impact time range"
              value={rangeValue}
              options={RANGE_OPTIONS}
              onChange={(opt) => opt && setImpactRange(opt.value as ImpactRange)}
              isSearchable={false}
            />
          </div>
          {mode === "compact" ? (
            <AppButton size="sm" to={projectImpactRoute} iconBefore={<ArrowRight size={12} />}>
              See more
            </AppButton>
          ) : null}
        </div>
      </div>
      <div className="panel-body">
        <StatGrid>
          <StatTile
            metricKey="impact.mergedRuns"
            value={impact.totals.mergedRuns}
            previous={impact.previousTotals?.mergedRuns}
            compareLabel={impactCompareLbl}
            to={mergedRoute}
          />
          <StatTile
            metricKey="impact.prsOpen"
            value={openPrTotal}
            previous={impact.previousTotals?.prsOpen}
            compareLabel={impactCompareLbl}
            to={openPrTotal > 0 ? deliveryRoute : undefined}
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
        </StatGrid>

        {mode === "full" ? (
          <>
            {impact.categoryTotals.length ? (
              <div className="mt-5">
                <div className="panel-subheader">By category</div>
                <div className="category-chips">
                  {impact.categoryTotals.map((row) => (
                    <Link
                      key={row.category}
                      to={categoryRoute(row.category)}
                      className="category-chip"
                    >
                      {row.category}
                      <span className="category-chip__count">{row.runs}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            {impactAgents.length ? (
              <div className="mt-5">
                <div className="panel-subheader">Agents in range</div>
                <div className="agent-visibility">
                  {impactAgents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className={`agent-visibility__chip${!isAgentVisible(agent.id) ? " agent-visibility__chip--hidden" : ""}`}
                      onClick={() => toggleAgentVisibility(agent.id)}
                    >
                      {agent.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {visibleImpactItems.length ? (
              <div className="table-wrap mt-5">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Subject</th>
                      <th>Summary</th>
                      <th>Trust</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleImpactItems.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link to={`/runs/${item.runId}`} className="entity-name">
                            {item.agentName}
                          </Link>
                        </td>
                        <td className="mono">{item.subject}</td>
                        <td>{item.summary}</td>
                        <td>
                          <VerificationBadge verification={item.verification} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : impact.recentItems.length > 0 ? (
              <div className="muted text-sm impact-empty">
                All agents are hidden — turn an agent back on to see its impact items
              </div>
            ) : null}
            <div className="toolbar mt-5">
              <AppButton size="sm" to={browseAllRoute} iconBefore={<ArrowRight size={12} />}>
                Browse all impact items
              </AppButton>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
