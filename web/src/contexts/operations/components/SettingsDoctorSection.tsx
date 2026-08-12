import { useCallback, useEffect, useMemo, useState } from "react";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { RefreshCw } from "lucide-react";

import { getInstanceDoctor } from "@/contexts/operations/contract";
import { AppButton } from "@/ui/AppButton";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";
import { useClientPager } from "@/platform/useClientPager";
import type { InstanceDoctorResult } from "@/contexts/operations/types";

export function SettingsDoctorSection({ onError }: { onError: (msg: string) => void }) {
  const [doctor, setDoctor] = useState<InstanceDoctorResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const daemonPathSummary = useMemo(() => {
    const path = doctor?.daemonPath?.trim() ?? "";
    if (!path) return null;
    const entries = path.split(":").filter(Boolean);
    const bunPath = doctor?.tools?.find((tool) => tool.name === "bun")?.path;
    const bunDir = bunPath?.replace(/\/[^/]+$/, "") ?? "";
    const hasBunBin =
      entries.some((e) => e.includes("/.bun/bin") || e.endsWith(".bun/bin")) ||
      (bunDir.length > 0 && entries.includes(bunDir));
    return { entryCount: entries.length, hasBunBin };
  }, [doctor]);

  const filtered = useMemo(() => {
    const agents = doctor?.agents ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.version?.toLowerCase().includes(q) ?? false),
    );
  }, [doctor, query]);

  const sortedItems = useMemo(() => filtered, [filtered]);
  const pager = useClientPager(sortedItems, 25, {
    defaultSort: "name",
    defaultOrder: "asc",
  });

  // Client sort by field & order.
  const displayed = useMemo(() => {
    const arr = [...sortedItems];
    arr.sort((a, b) => {
      let cmp = 0;
      if (pager.sort === "name") cmp = a.name.localeCompare(b.name);
      else if (pager.sort === "installed")
        cmp = Number(b.installed) - Number(a.installed);
      else if (pager.sort === "version")
        cmp = (a.version ?? "").localeCompare(b.version ?? "");
      return pager.order === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [sortedItems, pager.sort, pager.order]);

  const finalPager = useClientPager(displayed, 25, {
    defaultSort: pager.sort,
    defaultOrder: pager.order,
  });

  const load = useCallback(async () => {
    setDoctor(await getInstanceDoctor());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setBusy(true);
    try {
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Doctor failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        Diagnostics
        <AppButton
          size="sm"
          loading={busy}
          loadingLabel="Working…"
          onClick={() => void refresh()}
          iconBefore={<RefreshCw size={12} />}
        >
          Re-run
        </AppButton>
      </div>
      <div className="panel-body">
        {!doctor ? (
          <div className="muted">No diagnostics yet</div>
        ) : (
          <>
            <div className="mono">
              git=<span className={doctor.git ? "ok" : "bad"}>{String(doctor.git)}</span> disk=
              <span className={doctor.disk ? "ok" : "bad"}>{String(doctor.disk)}</span> database=
              <span className={doctor.database ? "ok" : "bad"}>{String(doctor.database)}</span>{" "}
              binary=
              <span className={doctor.binaryStale ? "bad" : "ok"}>
                {doctor.binaryStale ? "stale" : "current"}
              </span>
            </div>
            {(doctor.warnings ?? []).map((warning, idx) => (
              <div key={`doc-warn-${idx}`} className="alert alert-error mt-3">
                {warning}
              </div>
            ))}
            <div className="mono muted mt-3">home={doctor.home}</div>
            {doctor.tools?.length ? (
              <div className="mt-5">
                <div className="muted">Tools (daemon PATH)</div>
                <ul className="mt-2">
                  {doctor.tools.map((tool) => (
                    <li key={tool.name} className="mono">
                      <span className={tool.found ? "ok" : "bad"}>{tool.name}</span>
                      <span className="muted"> — {tool.found ? tool.path ?? "found" : "missing"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {daemonPathSummary ? (
              <details className="daemon-path mt-5">
                <summary className="muted">
                  Daemon PATH — {daemonPathSummary.entryCount} entries{" "}
                  <span className={daemonPathSummary.hasBunBin ? "ok" : "bad"}>
                    · ~/.bun/bin {daemonPathSummary.hasBunBin ? "present" : "missing"}
                  </span>
                </summary>
                <pre className="daemon-path-body mono muted">{doctor.daemonPath}</pre>
              </details>
            ) : null}
            <div className="inline-form mt-5 task-filters">
              <div className="field flex-2">
                <label htmlFor="doctor-agent-search">Search agents</label>
                <Textfield
                  id="doctor-agent-search"
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  placeholder="Adapter name…"
                  type="search"
                />
              </div>
            </div>
            <div className="table-wrap mt-5">
              <table className="data">
                <thead>
                  <tr>
                    <SortableTh
                      column="name"
                      label="Agent"
                      sort={finalPager.sort}
                      order={finalPager.order}
                      onSort={finalPager.setSort}
                    />
                    <SortableTh
                      column="installed"
                      label="Installed"
                      sort={finalPager.sort}
                      order={finalPager.order}
                      defaultOrder="desc"
                      onSort={finalPager.setSort}
                    />
                    <SortableTh
                      column="version"
                      label="Version"
                      sort={finalPager.sort}
                      order={finalPager.order}
                      onSort={finalPager.setSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {finalPager.items.map((agent) => (
                    <tr key={agent.name}>
                      <td className="mono">{agent.name}</td>
                      <td>{agent.installed ? "yes" : "no"}</td>
                      <td className="mono muted">{agent.version ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePager
              page={finalPager.page + 1}
              pageCount={finalPager.pageCount}
              rangeLabel={finalPager.rangeLabel}
              total={finalPager.total}
              onPageChange={(p) => finalPager.setPage(p - 1)}
            />
          </>
        )}
      </div>
    </section>
  );
}
