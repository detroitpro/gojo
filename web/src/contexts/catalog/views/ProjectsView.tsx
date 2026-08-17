import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { FolderOpen, Plus } from "lucide-react";

import { ActionMenu, type ActionMenuItem } from "@/ui/ActionMenu";
import { AppButton } from "@/ui/AppButton";
import { AppSectionMessage } from "@/ui/AppSectionMessage";
import { PageHeader } from "@/ui/PageHeader";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { DirectoryPicker } from "@/contexts/operations/components/DirectoryPicker";
import { ModalDialog } from "@/ui/ModalDialog";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";
import { EnabledBadge } from "@/ui/status/EnabledBadge";
import { HealthBadge } from "@/ui/status/HealthBadge";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useServerTable } from "@/platform/useServerTable";
import {
  createProject,
  deleteProject,
  disableProject,
  enableProject,
  listProjects,
  syncProject,
  useCatalogStore,
} from "@/contexts/catalog/contract";
import { getProjectDoctor } from "@/contexts/operations/contract";
import {
  computeProjectHealth,
  type ProjectHealthSummary,
} from "@/kernel/project-manifest";
import type { Order } from "@/platform/useClientPager";
import type { Project } from "@/contexts/catalog/types";

const PROJECT_SORT_ALLOWED = ["name", "createdAt", "updatedAt", "defaultBranch"] as const;

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || "project";
}

function configSummary(project: Project): string {
  if (!project.hasManifest && project.agentCount === 0) return "Not synced";
  return `${project.enabledAgentCount}/${project.agentCount} agents · ${project.enabledScheduleCount}/${project.scheduleCount} schedules`;
}

export function ProjectsView() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialSort = useMemo(() => {
    const v = searchParams.get("sort") ?? "";
    return (PROJECT_SORT_ALLOWED as readonly string[]).includes(v) ? v : "createdAt";
  }, [searchParams]);
  const initialOrder: Order = useMemo(() => {
    const v = searchParams.get("order");
    return v === "desc" ? "desc" : "asc";
  }, [searchParams]);

  const [query, setQuery] = useState("");
  const [hasOpenPrs, setHasOpenPrs] = useState(
    searchParams.get("hasOpenPrs") === "1" || searchParams.get("hasOpenPrs") === "true",
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [healthById, setHealthById] = useState<Record<string, ProjectHealthSummary>>({});
  const [healthLoading, setHealthLoading] = useState(false);

  const table = useServerTable<Project>({
    defaultSort: initialSort,
    defaultOrder: initialOrder,
    watchSources: [query, hasOpenPrs],
    fetchPage: ({ limit, offset, sort, order }) =>
      listProjects({
        limit,
        offset,
        sort,
        order,
        q: query || undefined,
        ...(hasOpenPrs ? { hasOpenPrs: true } : {}),
      }),
  });

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (table.sort !== "createdAt" || table.order !== "asc") {
      next.set("sort", table.sort);
      next.set("order", table.order);
    } else {
      next.delete("sort");
      next.delete("order");
    }
    if (hasOpenPrs) next.set("hasOpenPrs", "1");
    else next.delete("hasOpenPrs");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.sort, table.order, hasOpenPrs]);

  const refreshHealth = useCallback(async (list: Project[]) => {
    if (list.length === 0) {
      setHealthById({});
      return;
    }
    setHealthLoading(true);
    const next: Record<string, ProjectHealthSummary> = {};
    await Promise.all(
      list.map(async (project) => {
        try {
          const doctor = await getProjectDoctor(project.id);
          next[project.id] = computeProjectHealth(project, doctor);
        } catch {
          next[project.id] = { score: null, level: "warn", label: "Unavailable" };
        }
      }),
    );
    setHealthById((prev) => ({ ...prev, ...next }));
    setHealthLoading(false);
  }, []);

  useEffect(() => {
    void refreshHealth(table.items);
  }, [table.items, refreshHealth]);

  const load = table.load;
  const catalogRefresh = useCallback(async () => {
    await load();
  }, [load]);
  useBindStoreRefresh(useCatalogStore.getState(), catalogRefresh);

  function healthFor(project: Project): ProjectHealthSummary {
    return (
      healthById[project.id] ?? {
        score: null,
        level: project.hasManifest ? "warn" : "missing",
        label: project.hasManifest ? "…" : "No manifest",
      }
    );
  }

  const navigate = useNavigate();

  function rowActions(project: Project): ActionMenuItem[] {
    return [
      { id: "open", label: "Open", to: `/projects/${project.id}` },
      { id: "sync", label: "Sync", disabled: busyId === project.id },
      {
        id: "toggle-enabled",
        label: project.enabled === false ? "Enable" : "Disable",
        disabled: busyId === project.id,
      },
      { id: "remove", label: "Remove", danger: true, disabled: busyId === project.id },
    ];
  }

  async function sync(project: Project) {
    setBusyId(project.id);
    setError("");
    setNotice("");
    try {
      const result = await syncProject(project.id);
      const leaf = result.sync.manifestPath
        ? result.sync.manifestPath.split(/[/\\]/).slice(-1)[0]
        : "no manifest";
      setNotice(
        `${project.name}: synced from ${leaf} — ${result.sync.profiles} profiles, ${result.sync.agents} agents, ${result.sync.schedules} schedules`,
      );
      await load();
      try {
        const doctor = await getProjectDoctor(project.id);
        setHealthById((prev) => ({
          ...prev,
          [project.id]: computeProjectHealth(result.project, doctor),
        }));
      } catch {
        // health refresh best-effort
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleEnabled(project: Project) {
    setBusyId(project.id);
    setError("");
    setNotice("");
    try {
      if (project.enabled === false) {
        await enableProject(project.id);
        setNotice(
          `${project.name}: enabled (runtime). Next Sync reapplies gojo.yaml if it disagrees.`,
        );
      } else {
        await disableProject(project.id);
        setNotice(
          `${project.name}: disabled (runtime). New runs stay off until enable or Sync.`,
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update project");
    } finally {
      setBusyId(null);
    }
  }

  function onAction(project: Project, actionId: string) {
    if (actionId === "open") navigate(`/projects/${project.id}`);
    else if (actionId === "sync") void sync(project);
    else if (actionId === "toggle-enabled") void toggleEnabled(project);
    else if (actionId === "remove") setRemoveTarget(project);
  }

  async function confirmRemove() {
    const project = removeTarget;
    if (!project) return;
    setBusyId(project.id);
    setError("");
    setNotice("");
    try {
      await deleteProject(project.id);
      setRemoveTarget(null);
      setHealthById((prev) => {
        const { [project.id]: _removed, ...rest } = prev;
        return rest;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusyId(null);
    }
  }

  function onPicked(path: string) {
    setRepoPath(path);
    if (!name.trim()) setName(basename(path));
    setPickerOpen(false);
  }

  function openAdd() {
    setFormError("");
    setAddOpen(true);
  }

  function closeAdd() {
    if (creating || pickerOpen) return;
    setAddOpen(false);
    setFormError("");
  }

  async function addProject(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim() || !repoPath.trim()) {
      setFormError("Name and repository path are required");
      return;
    }
    setCreating(true);
    setFormError("");
    setNotice("");
    try {
      await createProject({ name: name.trim(), repoPath: repoPath.trim() });
      setName("");
      setRepoPath("");
      setAddOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  const totalDisplay = table.total;

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Registered repositories — sync manifests, check health, open details"
        actions={
          <AppButton
            variant="primary"
            onClick={openAdd}
            iconBefore={<Plus size={16} />}
          >
            Add project
          </AppButton>
        }
      />

      {error || table.error ? (
        <AppSectionMessage appearance="error">{error || table.error}</AppSectionMessage>
      ) : null}
      {notice ? <AppSectionMessage appearance="success">{notice}</AppSectionMessage> : null}

      <div className="inline-form mb-7 task-filters">
        <div className="field flex-2">
          <label htmlFor="project-search">Search</label>
          <Textfield
            id="project-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Name, path, id…"
          />
        </div>
        <div className="field">
          <label htmlFor="project-open-prs">Open PRs</label>
          <label className="checkbox-row" htmlFor="project-open-prs">
            <input
              id="project-open-prs"
              type="checkbox"
              checked={hasOpenPrs}
              onChange={(e) => setHasOpenPrs(e.currentTarget.checked)}
            />
            Has open PRs
          </label>
        </div>
        <div className="field task-filter-count">
          <label>&nbsp;</label>
          <span className="muted">
            {totalDisplay} project{totalDisplay === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {table.loading && table.items.length === 0 ? (
        <div className="empty">Loading projects…</div>
      ) : totalDisplay === 0 ? (
        <div className="empty">
          {query || hasOpenPrs
            ? "No projects match these filters"
            : "No projects yet — use Add project to register a repository"}
        </div>
      ) : (
        <>
          <div className="table-wrap">
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
                  <th>Status</th>
                  <th>Repo path</th>
                  <SortableTh
                    column="defaultBranch"
                    label="Branch"
                    sort={table.sort}
                    order={table.order}
                    onSort={table.setSort}
                  />
                  <th>Config</th>
                  <th>Open PRs</th>
                  <th>
                    Health
                    {healthLoading ? <span className="muted text-sm"> …</span> : null}
                  </th>
                  <SortableTh
                    column="updatedAt"
                    label="Updated"
                    sort={table.sort}
                    order={table.order}
                    defaultOrder="desc"
                    onSort={table.setSort}
                  />
                  <th />
                </tr>
              </thead>
              <tbody>
                {table.items.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link to={`/projects/${project.id}`} className="entity-name">
                        {project.name}
                      </Link>
                      <div className="mono muted text-sm">{project.id.slice(0, 10)}…</div>
                    </td>
                    <td>
                      <EnabledBadge enabled={project.enabled !== false} />
                    </td>
                    <td className="mono muted">{project.repoPath}</td>
                    <td className="mono">{project.defaultBranch}</td>
                    <td className="muted">{configSummary(project)}</td>
                    <td>
                      {project.openPrCount > 0 ? (
                        <Link
                          to={`/projects/${project.id}/overview#delivery`}
                          className="entity-name"
                        >
                          {project.openPrCount}
                        </Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <Link
                        to={`/projects/${project.id}/health`}
                        className="health-badge-link"
                      >
                        <HealthBadge
                          level={healthFor(project).level}
                          label={healthFor(project).label}
                        />
                      </Link>
                    </td>
                    <td className="mono muted">
                      {new Date(project.updatedAt).toLocaleString()}
                    </td>
                    <td className="actions-cell">
                      <ActionMenu
                        items={rowActions(project)}
                        disabled={busyId === project.id}
                        label={`Actions for ${project.name}`}
                        onSelect={(id) => onAction(project, id)}
                      />
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

      <ModalDialog
        open={addOpen}
        title="Add project"
        wide
        onClose={pickerOpen || creating ? () => {} : closeAdd}
        footer={
          <>
            <AppButton disabled={creating} onClick={closeAdd}>
              Cancel
            </AppButton>
            <AppButton
              variant="primary"
              type="submit"
              form="add-project-form"
              loading={creating}
              loadingLabel="Adding…"
              iconBefore={<Plus size={12} />}
            >
              Add project
            </AppButton>
          </>
        }
      >
        <form id="add-project-form" onSubmit={addProject}>
          {formError ? (
            <AppSectionMessage appearance="error">{formError}</AppSectionMessage>
          ) : null}
          <div className="field">
            <label htmlFor="project-name">Name</label>
            <Textfield
              id="project-name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="my-app"
              isDisabled={creating}
              isRequired
            />
          </div>
          <div className="field">
            <label htmlFor="project-path">Repository path</label>
            <div className="path-input-row">
              <Textfield
                id="project-path"
                value={repoPath}
                onChange={(e) => setRepoPath(e.currentTarget.value)}
                placeholder="Browse to a git checkout…"
                isDisabled={creating}
                isReadOnly
                onClick={() => setPickerOpen(true)}
                isRequired
              />
              <AppButton
                disabled={creating}
                onClick={() => setPickerOpen(true)}
                iconBefore={<FolderOpen size={12} />}
              >
                Browse
              </AppButton>
            </div>
          </div>
        </form>
      </ModalDialog>

      <DirectoryPicker
        open={pickerOpen}
        initialPath={repoPath || undefined}
        onClose={() => setPickerOpen(false)}
        onSelect={onPicked}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove project?"
        confirmLabel="Remove project"
        danger
        busy={Boolean(removeTarget && busyId === removeTarget.id)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => void confirmRemove()}
      >
        <p>
          Unregister <strong>{removeTarget?.name}</strong> from gojo. Scheduled work for this
          project stops, and gojo's local history for it is removed.
        </p>
        <p className="muted mt-3">
          This does <strong>not</strong> delete the git repository at{" "}
          <span className="mono">{removeTarget?.repoPath}</span>.
        </p>
      </ConfirmDialog>
    </div>
  );
}
