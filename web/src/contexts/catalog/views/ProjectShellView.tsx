import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  HeartPulse,
  History,
  LayoutDashboard,
  Power,
  RefreshCw,
  Settings2,
} from "lucide-react";

import { ActionMenu, type ActionMenuItem } from "@/ui/ActionMenu";
import { AppButton } from "@/ui/AppButton";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { PageHeader } from "@/ui/PageHeader";
import { ProjectSubnav, type ProjectSubnavItem } from "@/ui/ProjectSubnav";
import { HealthBadge } from "@/ui/status/HealthBadge";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useSoftLoading } from "@/platform/useSoftLoading";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import { computeProjectHealth } from "@/kernel/project-manifest";
import { formatRelativeTime } from "@/kernel/project-overview";
import {
  deleteProject,
  disableProject,
  enableProject,
  getProject,
  listAgents,
  syncProject,
  useCatalogStore,
} from "@/contexts/catalog/contract";
import { getProjectDoctor } from "@/contexts/operations/contract";
import type { Agent, Project, ProjectSyncResult } from "@/contexts/catalog/types";
import type { ProjectDoctorResult } from "@/contexts/operations/contract";
import {
  ProjectShellContext,
  type ProjectShellContextValue,
} from "@/contexts/catalog/project-shell";

export function ProjectShellView() {
  const { id: projectId = "" } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [doctor, setDoctor] = useState<ProjectDoctorResult | null>(null);
  const [lastSync, setLastSync] = useState<ProjectSyncResult | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [projectAgents, setProjectAgents] = useState<Agent[]>([]);
  const [openPrTotal, setOpenPrTotal] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);

  const soft = useSoftLoading(Boolean(project));

  const load = useCallback(async () => {
    setError("");
    try {
      await soft.run(async () => {
        const p = await getProject(projectId);
        setProject(p);
        const d = await getProjectDoctor(projectId);
        setDoctor(d);
        const agents = await listAgents({
          limit: MAX_PAGE_LIMIT,
          offset: 0,
          projectId,
        });
        setProjectAgents(agents.items);
        setDataVersion((v) => v + 1);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
      if (!project) {
        setProject(null);
        setDoctor(null);
        setProjectAgents([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, soft.run]);

  useEffect(() => {
    setProject(null);
    setDoctor(null);
    setProjectAgents([]);
    setLastSync(null);
    setLastSyncAt(null);
    setOpenPrTotal(0);
    setNotice("");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useBindStoreRefresh(useCatalogStore.getState(), load);

  async function runSync() {
    if (!project) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await syncProject(project.id);
      setProject(result.project);
      setLastSync(result.sync);
      setLastSyncAt(new Date().toISOString());
      const path = result.sync.manifestPath
        ? result.sync.manifestPath.split(/[/\\]/).slice(-2).join("/")
        : "no manifest file";
      setNotice(
        `Synced from ${path} — ${result.sync.profiles} profiles, ${result.sync.agents} agents, ${result.sync.schedules} schedules`,
      );
      setDoctor(await getProjectDoctor(result.project.id));
      const agents = await listAgents({
        limit: MAX_PAGE_LIMIT,
        offset: 0,
        projectId: result.project.id,
      });
      setProjectAgents(agents.items);
      setDataVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!project) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = project.enabled
        ? await disableProject(project.id)
        : await enableProject(project.id);
      setProject(next);
      setNotice(
        next.enabled
          ? "Project enabled (runtime). Next Sync reapplies gojo.yaml if it disagrees."
          : "Project disabled (runtime). Schedules and triggers stay off until enable or Sync.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update project");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      await deleteProject(project.id);
      setRemoveOpen(false);
      navigate("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
      setBusy(false);
    }
  }

  const health = project
    ? computeProjectHealth(project, doctor)
    : { score: null, level: "missing" as const, label: "…" };

  const repoIdentity = useMemo(() => {
    const remote = project?.remoteUrl;
    if (!remote) return null;
    try {
      const path = new URL(remote.replace(/\.git$/, "")).pathname.replace(/^\/+/, "");
      return path || null;
    } catch {
      return remote.replace(/\.git$/, "");
    }
  }, [project?.remoteUrl]);

  const lastObservedLabel = lastSyncAt
    ? `Synced ${formatRelativeTime(lastSyncAt)}`
    : project?.updatedAt
      ? `Updated ${formatRelativeTime(project.updatedAt)}`
      : null;

  const subnavItems: ProjectSubnavItem[] = [
    {
      name: "project-overview",
      label: "Overview",
      icon: LayoutDashboard,
      to: `/projects/${projectId}/overview`,
    },
    {
      name: "project-history",
      label: "History",
      icon: History,
      to: `/projects/${projectId}/history`,
    },
    {
      name: "project-impact",
      label: "Impact",
      icon: Activity,
      to: `/projects/${projectId}/impact`,
    },
    {
      name: "project-health",
      label: "Health",
      icon: HeartPulse,
      to: `/projects/${projectId}/health`,
    },
    {
      name: "project-configuration",
      label: "Configuration",
      icon: Settings2,
      to: `/projects/${projectId}/configuration`,
    },
  ];

  const overflowItems: ActionMenuItem[] = [
    { id: "remove", label: "Remove project", danger: true },
  ];

  const ctx: ProjectShellContextValue = {
    projectId,
    project,
    doctor,
    projectAgents,
    lastSync,
    openPrTotal,
    dataVersion,
    setOpenPrTotal,
    setError,
    setNotice,
  };

  return (
    <div>
      <PageHeader
        title={project?.name ?? "Project"}
        subtitle={
          project ? (
            <div className="project-shell-subtitle">
              <div className="project-shell-subtitle__row">
                {repoIdentity ? (
                  <span className="project-shell-subtitle__repo">{repoIdentity}</span>
                ) : null}
                <Link
                  to={`/projects/${project.id}/health`}
                  className="project-shell-subtitle__health"
                >
                  <HealthBadge level={health.level} label={health.label} />
                </Link>
                {lastObservedLabel ? (
                  <span className="project-shell-subtitle__meta" title={project.updatedAt}>
                    {lastObservedLabel}
                  </span>
                ) : null}
              </div>
              <div
                className="project-shell-subtitle__id mono"
                title={project.id}
              >
                {project.id}
              </div>
            </div>
          ) : null
        }
        actions={
          <>
            <AppButton
              variant="primary"
              loading={busy}
              loadingLabel="Syncing…"
              disabled={!project}
              onClick={() => void runSync()}
              iconBefore={<RefreshCw size={16} />}
            >
              Sync
            </AppButton>{" "}
            <AppButton
              loading={busy}
              loadingLabel="Working…"
              disabled={!project}
              title={
                project
                  ? "Runtime toggle — lasts until the next Sync if the manifest disagrees"
                  : undefined
              }
              onClick={() => void toggleEnabled()}
              iconBefore={<Power size={16} />}
            >
              {project?.enabled === false ? "Enable" : "Disable"}
            </AppButton>{" "}
            <ActionMenu
              items={overflowItems}
              disabled={!project}
              label="Project actions"
              onSelect={(id) => {
                if (id === "remove") setRemoveOpen(true);
              }}
            />
          </>
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}

      {soft.loading && !project ? (
        <div className="empty">Loading…</div>
      ) : project ? (
        <ProjectShellContext.Provider value={ctx}>
          <ProjectSubnav items={subnavItems} />
          <Outlet />
        </ProjectShellContext.Provider>
      ) : null}

      <ConfirmDialog
        open={removeOpen}
        title="Remove project?"
        confirmLabel="Remove project"
        danger
        busy={busy}
        onClose={() => setRemoveOpen(false)}
        onConfirm={() => void confirmRemove()}
      >
        <p>
          Unregister <strong>{project?.name}</strong> from gojo. Scheduled work for this project
          stops, and gojo's local history for it is removed.
        </p>
        <p className="muted mt-3">
          This does <strong>not</strong> delete the git repository at{" "}
          <span className="mono">{project?.repoPath}</span>.
        </p>
      </ConfirmDialog>
    </div>
  );
}
