import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { GitMerge } from "lucide-react";

import { AttentionSummary } from "@/contexts/catalog/components/overview/AttentionSummary";
import { CurrentActivitySection } from "@/contexts/catalog/components/overview/CurrentActivitySection";
import { RecentActivitySection } from "@/contexts/catalog/components/overview/RecentActivitySection";
import { ProjectImpactBrief } from "@/contexts/catalog/components/overview/ProjectImpactBrief";
import { useProjectShell } from "@/contexts/catalog/project-shell";
import { listImpactItems, runAgent } from "@/contexts/catalog/contract";
import {
  getProjectWorkStatus,
  listProjectSources,
  listProjectWork,
  recheckWorkItem,
  refreshProjectSource,
  resolveWorkItem,
  useWorkStore,
} from "@/contexts/work/contract";
import type { ProjectSource, WorkItem, WorkStatus } from "@/contexts/work/contract";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import {
  RECENT_CHANGES_LIMIT,
  buildProgressSummary,
  collapseHistoryForOverview,
  groupChangesByDay,
  inventoryAvailableWork,
  isActiveWork,
  isAttentionWork,
  presentCompletedWork,
  repositoryBrowseUrl,
  summarizeCompletedWork,
} from "@/kernel/project-overview";
import { attentionPrimaryAction } from "@/kernel/work-attention";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useSoftLoading } from "@/platform/useSoftLoading";
import { AppButton } from "@/ui/AppButton";
import { AppSectionMessage } from "@/ui/AppSectionMessage";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

export function ProjectOverviewView() {
  const shell = useProjectShell();
  const { project, projectId, dataVersion, projectAgents, setOpenPrTotal } = shell;
  const location = useLocation();
  const navigate = useNavigate();

  const [activeItems, setActiveItems] = useState<WorkItem[]>([]);
  const [historyItems, setHistoryItems] = useState<WorkItem[]>([]);
  const [impactByRun, setImpactByRun] = useState<Record<string, string[]>>({});
  const [workStatus, setWorkStatus] = useState<WorkStatus | null>(null);
  const [projectSources, setProjectSources] = useState<ProjectSource[]>([]);
  const [attentionBusyId, setAttentionBusyId] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<WorkItem | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const activeSoft = useSoftLoading(activeItems.length > 0);
  const historySoft = useSoftLoading(historyItems.length > 0);

  const mergeBabysitter = useMemo(
    () =>
      projectAgents.find((agent) => agent.name === "maintain-merge" && agent.enabled) ?? null,
    [projectAgents],
  );

  const sourceWebUrls = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const source of projectSources) {
      map.set(source.id, source.webUrl);
    }
    return map;
  }, [projectSources]);

  const attentionItems = useMemo(() => activeItems.filter(isAttentionWork), [activeItems]);
  const availableWork = useMemo(() => inventoryAvailableWork(activeItems), [activeItems]);

  const repositoryWebUrl =
    repositoryBrowseUrl(projectSources.find((s) => s.webUrl)?.webUrl) ??
    repositoryBrowseUrl(project?.remoteUrl) ??
    null;

  const completedPresentations = useMemo(
    () => collapseHistoryForOverview(historyItems).map((item) => presentCompletedWork(item)),
    [historyItems],
  );
  const dayGroups = useMemo(() => groupChangesByDay(completedPresentations), [
    completedPresentations,
  ]);
  const activityMetrics = useMemo(() => summarizeCompletedWork(historyItems), [historyItems]);
  const activeCount = useMemo(() => activeItems.filter(isActiveWork).length, [activeItems]);

  const digestText = useMemo(
    () =>
      buildProgressSummary({
        completed: historyItems,
        attentionCount: attentionItems.length,
        activeCount,
        projectEnabled: project?.enabled !== false,
      }).text,
    [historyItems, attentionItems.length, activeCount, project?.enabled],
  );

  const emptyMessage = "No completed changes yet.";
  const emptyHint = useMemo(() => {
    if (project?.enabled === false) {
      return "This project is disabled — new scheduled and API runs are blocked.";
    }
    if (activeError) return null;
    if ((workStatus?.needsAttention ?? 0) > 0) {
      return "There are items that need attention above.";
    }
    if ((project?.enabledScheduleCount ?? 0) === 0) {
      return "No enabled schedules are configured for this project.";
    }
    return "When agents complete runs or merge delivery work, outcomes will appear here.";
  }, [project?.enabled, project?.enabledScheduleCount, activeError, workStatus?.needsAttention]);

  const openPrTotal = workStatus?.verifiedOpen ?? 0;

  const loadActive = useCallback(async () => {
    setActiveError(null);
    try {
      await activeSoft.run(async () => {
        const [page, status, sources] = await Promise.all([
          listProjectWork(projectId, { limit: MAX_PAGE_LIMIT, offset: 0 }),
          getProjectWorkStatus(projectId),
          listProjectSources(projectId),
        ]);
        setActiveItems(page.items);
        setWorkStatus(status);
        setProjectSources(sources);
        setOpenPrTotal(status.verifiedOpen);
      });
    } catch (err) {
      setActiveError(err instanceof Error ? err.message : "Failed to load active work");
    }
  }, [projectId, activeSoft.run, setOpenPrTotal]);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      await historySoft.run(async () => {
        const page = await listProjectWork(projectId, {
          limit: RECENT_CHANGES_LIMIT,
          offset: 0,
          history: true,
        });
        setHistoryItems(page.items);
      });
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load completed work");
    }
  }, [projectId, historySoft.run]);

  const loadImpact = useCallback(async () => {
    try {
      const page = await listImpactItems({
        projectId,
        limit: MAX_PAGE_LIMIT,
        offset: 0,
      });
      const next: Record<string, string[]> = {};
      for (const row of page.items) {
        const existing = next[row.runId] ?? [];
        if (!existing.includes(row.category)) existing.push(row.category);
        next[row.runId] = existing;
      }
      setImpactByRun(next);
    } catch {
      setImpactByRun({});
    }
  }, [projectId]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadActive(), loadHistory(), loadImpact()]);
  }, [loadActive, loadHistory, loadImpact]);

  useEffect(() => {
    setActiveItems([]);
    setHistoryItems([]);
    setImpactByRun({});
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  useBindStoreRefresh(useWorkStore.getState(), loadAll);

  useEffect(() => {
    if (
      location.hash === "#delivery" ||
      location.hash === "#open-prs" ||
      location.hash === "#attention"
    ) {
      requestAnimationFrame(() => {
        document
          .getElementById("attention")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [location.hash]);

  async function runAttentionRecheck(item: WorkItem) {
    setAttentionBusyId(item.id);
    shell.setError("");
    shell.setNotice("");
    try {
      const result = await recheckWorkItem(item.id);
      const detail = result.detail ? ` — ${result.detail}` : "";
      if (result.status === "terminal") {
        shell.setNotice(`Verified ${result.work.title} as closed${detail}`);
      } else if (result.status === "unresolved") {
        shell.setNotice(`Still open: ${result.work.title}${detail}`);
      } else {
        shell.setNotice(`Updated ${result.work.title}${detail}`);
      }
      await loadAll();
    } catch (err) {
      shell.setError(err instanceof Error ? err.message : "Recheck failed");
    } finally {
      setAttentionBusyId("");
    }
  }

  async function runAttentionRetrySource(item: WorkItem) {
    if (!item.sourceId) return;
    setAttentionBusyId(item.id);
    shell.setError("");
    shell.setNotice("");
    try {
      await refreshProjectSource(projectId, item.sourceId);
      shell.setNotice("Source refresh queued");
      await loadAll();
    } catch (err) {
      shell.setError(err instanceof Error ? err.message : "Source refresh failed");
    } finally {
      setAttentionBusyId("");
    }
  }

  async function onPrimaryAttentionAction(item: WorkItem) {
    const sourceUrl = item.sourceId ? sourceWebUrls.get(item.sourceId) ?? null : null;
    const action = attentionPrimaryAction(item, sourceUrl);
    if (!action || action.kind === "route" || action.kind === "href") return;
    if (action.id === "recheck-item") await runAttentionRecheck(item);
    if (action.id === "retry-source") await runAttentionRetrySource(item);
  }

  async function onAttentionMenuAction(item: WorkItem, actionId: string) {
    if (actionId === "recheck-item") {
      await runAttentionRecheck(item);
      return;
    }
    if (actionId === "retry-source") {
      await runAttentionRetrySource(item);
      return;
    }
    if (actionId === "resolve") {
      setResolveTarget(item);
      setResolveOpen(true);
      return;
    }
    if (actionId === "open-source") {
      const url =
        item.webUrl ?? (item.sourceId ? sourceWebUrls.get(item.sourceId) ?? null : null);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function confirmResolve() {
    if (!resolveTarget) return;
    setAttentionBusyId(resolveTarget.id);
    shell.setError("");
    try {
      await resolveWorkItem(resolveTarget.id);
      shell.setNotice(`Resolved ${resolveTarget.title}`);
      setResolveOpen(false);
      setResolveTarget(null);
      await loadAll();
    } catch (err) {
      shell.setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setAttentionBusyId("");
    }
  }

  async function runMergeBabysitter() {
    if (!mergeBabysitter) return;
    setMergeBusy(true);
    shell.setError("");
    try {
      const run = await runAgent(mergeBabysitter.id);
      navigate(`/runs/${run.id}`);
    } catch (err) {
      shell.setError(err instanceof Error ? err.message : "Failed to enqueue merge babysitter");
      setMergeBusy(false);
    }
  }

  if (!project) return null;

  return (
    <>
      {project.enabled === false ? (
        <AppSectionMessage appearance="warning">
          Project disabled — new scheduled, work, and API runs are blocked until Enable or Sync.
        </AppSectionMessage>
      ) : null}

      <div id="attention">
        <AttentionSummary
          items={attentionItems}
          sourceWebUrls={sourceWebUrls}
          busyId={attentionBusyId}
          onPrimaryAction={(item) => void onPrimaryAttentionAction(item)}
          onMenuAction={(item, actionId) => void onAttentionMenuAction(item, actionId)}
        />
      </div>

      {mergeBabysitter && openPrTotal > 0 ? (
        <div className="delivery-nudge mb-5">
          <p className="text-sm muted">
            {openPrTotal} verified pull request{openPrTotal === 1 ? "" : "s"} awaiting merge
            (optional merge babysitter).
          </p>
          <AppButton
            variant="primary"
            size="sm"
            loading={mergeBusy}
            loadingLabel="Enqueueing…"
            onClick={() => void runMergeBabysitter()}
            iconBefore={<GitMerge size={12} />}
          >
            Run merge babysitter
          </AppButton>
        </div>
      ) : null}

      {activeError ? (
        <AppSectionMessage appearance="error">{activeError}</AppSectionMessage>
      ) : null}

      <div className="overview-layout">
        <div className="overview-layout__main">
          <CurrentActivitySection items={activeItems} />

          <RecentActivitySection
            metrics={activityMetrics}
            groups={dayGroups}
            impactByRun={impactByRun}
            digestText={digestText}
            loading={historySoft.loading}
            error={historyError}
            emptyMessage={emptyMessage}
            emptyHint={emptyHint}
            projectId={projectId}
            onRetry={() => void loadHistory()}
          />

          <ProjectImpactBrief
            projectId={projectId}
            availableWork={availableWork}
            repositoryWebUrl={repositoryWebUrl}
          />
        </div>
      </div>

      <ConfirmDialog
        open={resolveOpen}
        title="Mark work resolved?"
        confirmLabel="Mark resolved"
        danger
        busy={Boolean(resolveTarget && attentionBusyId === resolveTarget.id)}
        onClose={() => {
          setResolveOpen(false);
          setResolveTarget(null);
        }}
        onConfirm={() => void confirmResolve()}
      >
        <p>
          Remove <strong>{resolveTarget?.title}</strong> from Needs attention and keep it in
          History.
        </p>
        <p className="muted mt-3">
          This does not invent a merged or closed delivery. If the source later reports the work
          as active again, gojo will restore it.
        </p>
      </ConfirmDialog>
    </>
  );
}
