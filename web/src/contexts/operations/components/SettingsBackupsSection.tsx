import { useState } from "react";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { HardDrive, ShieldCheck } from "lucide-react";

import { createBackup, listBackups, verifyBackup } from "@/contexts/operations/contract";
import { AppButton } from "@/ui/AppButton";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";
import { useServerTable } from "@/platform/useServerTable";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsBackupsSection({
  onError,
  onMessage,
}: {
  onError: (msg: string) => void;
  onMessage: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const table = useServerTable({
    defaultSort: "createdAt",
    defaultOrder: "desc",
    watchSources: [query],
    fetchPage: ({ limit, offset, sort, order }) =>
      listBackups({
        limit,
        offset,
        sort,
        order,
        q: query || undefined,
      }),
  });

  async function doCreateBackup() {
    setBusy(true);
    try {
      const result = await createBackup();
      onMessage(`Backup created: ${result.path}`);
      await table.load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  }

  async function doVerify(path: string) {
    setBusy(true);
    try {
      const result = await verifyBackup(path);
      onMessage(result.valid ? `Valid: ${result.path}` : `Invalid: ${result.path}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Verify failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">Backups</div>
      <div className="panel-body">
        <p className="muted">
          Create and verify archives under the Gojo data directory. Restore remains CLI-only{" "}
          <span className="mono">gojo backup restore</span>.
        </p>
        <AppButton
          variant="primary"
          className="mt-4"
          loading={busy}
          loadingLabel="Creating…"
          onClick={() => void doCreateBackup()}
          iconBefore={<HardDrive size={12} />}
        >
          Create backup
        </AppButton>
        <div className="inline-form mt-5 task-filters">
          <div className="field flex-2">
            <label htmlFor="backup-search">Search</label>
            <Textfield
              id="backup-search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Backup name…"
              type="search"
            />
          </div>
        </div>
        {table.total === 0 ? (
          <div className="muted mt-5">
            {query.trim() ? "No backups match these filters" : "No backups"}
          </div>
        ) : (
          <>
            <div className="table-wrap mt-5">
              <table className="data">
                <thead>
                  <tr>
                    <SortableTh
                      column="name"
                      label="Name"
                      sort={table.sort}
                      order={table.order}
                      onSort={table.setSort}
                    />
                    <th>Size</th>
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
                  {table.items.map((backup) => (
                    <tr key={backup.path}>
                      <td className="mono">{backup.name}</td>
                      <td className="mono muted">{formatBytes(backup.size)}</td>
                      <td className="mono muted">{new Date(backup.createdAt).toLocaleString()}</td>
                      <td>
                        <AppButton
                          size="sm"
                          loading={busy}
                          loadingLabel="Verifying…"
                          onClick={() => void doVerify(backup.path)}
                          iconBefore={<ShieldCheck size={12} />}
                        >
                          Verify
                        </AppButton>
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
    </section>
  );
}
