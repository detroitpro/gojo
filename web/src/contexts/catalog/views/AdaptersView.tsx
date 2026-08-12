import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSelect as Select } from "@/ui/AppSelect";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { FlaskConical, RefreshCw } from "lucide-react";

import { listAdapters, testAdapter } from "@/contexts/catalog/contract";
import { AppButton } from "@/ui/AppButton";
import { PageHeader } from "@/ui/PageHeader";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";
import { useClientPager } from "@/platform/useClientPager";
import type { AdapterInfo, AdapterTestResult } from "@/contexts/catalog/types";

type InstalledFilter = "all" | "yes" | "no";

const INSTALLED_OPTIONS: Array<{ value: InstalledFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "yes", label: "Installed" },
  { value: "no", label: "Missing" },
];

export function AdaptersView() {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyName, setBusyName] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ name: string; result: AdapterTestResult } | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [installedFilter, setInstalledFilter] = useState<InstalledFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return adapters.filter((adapter) => {
      if (installedFilter === "yes" && !adapter.installed) return false;
      if (installedFilter === "no" && adapter.installed) return false;
      if (!q) return true;
      return (
        adapter.name.toLowerCase().includes(q) ||
        (adapter.version?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [adapters, installedFilter, query]);

  const sorted = useMemo(() => filtered, [filtered]);
  const pager = useClientPager(sorted, 25, { defaultSort: "name", defaultOrder: "asc" });

  const sortedFinal = useMemo(() => {
    const arr = [...sorted];
    arr.sort((a, b) => {
      let cmp = 0;
      if (pager.sort === "name") cmp = a.name.localeCompare(b.name);
      else if (pager.sort === "version")
        cmp = (a.version ?? "").localeCompare(b.version ?? "");
      else if (pager.sort === "installed") cmp = Number(a.installed) - Number(b.installed);
      return pager.order === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [sorted, pager.sort, pager.order]);

  const pageItems = sortedFinal.slice(pager.offset, pager.offset + pager.pageSize);

  useEffect(() => {
    pager.setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, installedFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAdapters(await listAdapters());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to detect adapters");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runTest(name: string) {
    setBusyName(name);
    setError("");
    setTestResult(null);
    try {
      const result = await testAdapter(name);
      setTestResult({ name, result });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adapter test failed");
    } finally {
      setBusyName(null);
    }
  }

  const installedOption =
    INSTALLED_OPTIONS.find((o) => o.value === installedFilter) ?? INSTALLED_OPTIONS[0];

  return (
    <div>
      <PageHeader
        title="Adapters"
        subtitle="Adapter detection status"
        actions={
          <AppButton
            loading={loading}
            loadingLabel="Detecting…"
            onClick={() => void load()}
            iconBefore={<RefreshCw size={16} />}
          >
            Re-detect
          </AppButton>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="inline-form mb-7 task-filters">
        <div className="field">
          <label htmlFor="adapter-installed-filter">Installed</label>
          <Select
            inputId="adapter-installed-filter"
            value={installedOption}
            options={INSTALLED_OPTIONS}
            onChange={(opt) => opt && setInstalledFilter(opt.value as InstalledFilter)}
            isSearchable={false}
          />
        </div>
        <div className="field flex-2">
          <label htmlFor="adapter-search">Search</label>
          <Textfield
            id="adapter-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Adapter name, version…"
          />
        </div>
        <div className="field task-filter-count">
          <label>&nbsp;</label>
          <span className="muted">
            {sortedFinal.length} adapter{sortedFinal.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="empty">Detecting…</div>
      ) : adapters.length === 0 ? (
        <div className="empty">No adapters registered</div>
      ) : sortedFinal.length === 0 ? (
        <div className="empty">No adapters match these filters</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <SortableTh
                    column="name"
                    label="Adapter"
                    sort={pager.sort}
                    order={pager.order}
                    onSort={pager.setSort}
                  />
                  <SortableTh
                    column="installed"
                    label="Installed"
                    sort={pager.sort}
                    order={pager.order}
                    defaultOrder="desc"
                    onSort={pager.setSort}
                  />
                  <SortableTh
                    column="version"
                    label="Version"
                    sort={pager.sort}
                    order={pager.order}
                    onSort={pager.setSort}
                  />
                  <th>Authenticated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageItems.map((adapter) => (
                  <tr key={adapter.name}>
                    <td className="mono">{adapter.name}</td>
                    <td>
                      <span className={`status-dot ${adapter.installed ? "ok" : "bad"}`} />{" "}
                      {adapter.installed ? "yes" : "no"}
                    </td>
                    <td className="mono muted">{adapter.version ?? "—"}</td>
                    <td>
                      {adapter.authenticated === undefined ? (
                        "—"
                      ) : (
                        <>
                          <span
                            className={`status-dot ${adapter.authenticated ? "ok" : "bad"}`}
                          />{" "}
                          {adapter.authenticated ? "yes" : "no"}
                        </>
                      )}
                    </td>
                    <td>
                      <AppButton
                        size="sm"
                        loading={busyName === adapter.name}
                        loadingLabel="Testing…"
                        onClick={() => void runTest(adapter.name)}
                        iconBefore={<FlaskConical size={12} />}
                      >
                        Test
                      </AppButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TablePager
            page={pager.page + 1}
            pageCount={pager.pageCount}
            rangeLabel={pager.rangeLabel}
            total={sortedFinal.length}
            onPageChange={(p) => pager.setPage(p - 1)}
          />
        </>
      )}

      {testResult ? (
        <section className="panel mt-7">
          <div className="panel-header">Test result — {testResult.name}</div>
          <div className="panel-body">
            <div className="mono">
              exitCode={testResult.result.exitCode} timedOut=
              {String(testResult.result.timedOut)} canceled={String(testResult.result.canceled)}
            </div>
            {testResult.result.stdout ? (
              <pre className="pre-block mt-4">{testResult.result.stdout}</pre>
            ) : null}
            {testResult.result.stderr ? (
              <pre className="pre-block mt-4">{testResult.result.stderr}</pre>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
