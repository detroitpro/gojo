import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, GitMerge, Play, RefreshCw } from "lucide-react";

import { runAgent } from "@/contexts/catalog/contract";
import type { Agent } from "@/contexts/catalog/types";
import {
  getProjectWorkStatus,
  listProjectSources,
  listProjectWork,
  recheckWorkItem,
  refreshProjectSource,
  resolveWorkItem,
  useWorkStore,
} from "@/contexts/work/contract";
import type { ProjectSource, WorkItem, WorkStatus } from "@/contexts/work/types";
import { ActionMenu, type ActionMenuItem } from "@/ui/ActionMenu";
import { AppButton } from "@/ui/AppButton";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { AttentionBadge } from "@/ui/status/AttentionBadge";
import { DeliveryBadge } from "@/ui/status/DeliveryBadge";
import { ExecutionBadge } from "@/ui/status/ExecutionBadge";
import { ProvenanceBadge } from "@/ui/status/ProvenanceBadge";
import { SyncStateBadge } from "@/ui/status/SyncStateBadge";
import { StatGrid } from "@/ui/StatGrid";
import { StatTile } from "@/ui/StatTile";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import {
  attentionMenuItems,
  attentionPrimaryAction,
  workExternalHref,
} from "@/kernel/work-attention";
import {
  workAgentProfileLabel,
  workPrimaryLabel,
  workSecondaryLabel,
} from "@/kernel/work-display";
import { compareLabel } from "@/kernel/stat-metrics";
import { isVerifiedActiveDelivery } from "@/kernel/work-visibility";

import { ProjectSourcesPanel } from "./ProjectSourcesPanel";

export type ProjectWorkPanelHandle = {
  loadWork: () => Promise<void>;
};

export type ProjectWorkPanelProps = {
  projectId: string;
  mergeBabysitter: Agent | null;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onOpenPrTotal: (n: number) => void;
};

export const ProjectWorkPanel = forwardRef<ProjectWorkPanelHandle, ProjectWorkPanelProps>(
  function ProjectWorkPanel(
    { projectId, mergeBabysitter, onError, onNotice, onOpenPrTotal },
    ref,
  ) {
    const navigate = useNavigate();

    const [workItems, setWorkItems] = useState<WorkItem[]>([]);
    const [workStatus, setWorkStatus] = useState<WorkStatus | null>(null);
    const [projectSources, setProjectSources] = useState<ProjectSource[]>([]);
    const [openPrTotal, setOpenPrTotal] = useState(0);
    const [mergeBusy, setMergeBusy] = useState(false);
    const [attentionBusyId, setAttentionBusyId] = useState("");
    const [resolveOpen, setResolveOpen] = useState(false);
    const [resolveTarget, setResolveTarget] = useState<WorkItem | null>(null);

    function workCompareLabelStr(): string {
      return compareLabel("asOf", workStatus?.compareWindow);
    }

    const nowWork = useMemo(
      () =>
        workItems.filter(
          (item) => item.execution !== "none" && item.execution !== "terminal",
        ),
      [workItems],
    );
    const attentionWork = useMemo(
      () =>
        workItems.filter(
          (item) => item.attention !== "none" && item.resolution == null,
        ),
      [workItems],
    );
    const deliveryWork = useMemo(
      () => workItems.filter(isVerifiedActiveDelivery),
      [workItems],
    );

    const sourceNames = useMemo(
      () => new Map(projectSources.map((source) => [source.id, source.displayName])),
      [projectSources],
    );
    const sourceWebUrls = useMemo(
      () => new Map(projectSources.map((source) => [source.id, source.webUrl])),
      [projectSources],
    );

    function sourceLabel(item: WorkItem): string {
      if (item.sourceId) return sourceNames.get(item.sourceId) ?? item.sourceId;
      return item.provenance === "gojo-agent" ? "gojo" : "local";
    }

    function sourceWebUrl(item: WorkItem): string | null {
      if (!item.sourceId) return null;
      return sourceWebUrls.get(item.sourceId) ?? null;
    }

    function observedLabel(item: WorkItem): string {
      if (!item.observedAt) return "not observed";
      return new Date(item.observedAt).toLocaleString();
    }

    function attentionHref(item: WorkItem): string | null {
      return workExternalHref(item, sourceWebUrl(item));
    }

    function primaryAttentionAction(item: WorkItem) {
      return attentionPrimaryAction(item, sourceWebUrl(item));
    }

    function attentionActions(item: WorkItem): ActionMenuItem[] {
      return attentionMenuItems(item, sourceWebUrl(item));
    }

    const loadWork = useCallback(async () => {
      try {
        const [page, status, sources] = await Promise.all([
          listProjectWork(projectId, { limit: MAX_PAGE_LIMIT, offset: 0 }),
          getProjectWorkStatus(projectId),
          listProjectSources(projectId),
        ]);
        setWorkItems(page.items);
        setWorkStatus(status);
        setProjectSources(sources);
        setOpenPrTotal(status.verifiedOpen);
        onOpenPrTotal(status.verifiedOpen);
      } catch {
        setWorkItems([]);
        setWorkStatus(null);
        setProjectSources([]);
        setOpenPrTotal(0);
        onOpenPrTotal(0);
      }
    }, [projectId, onOpenPrTotal]);

    useEffect(() => {
      setWorkItems([]);
      setWorkStatus(null);
      setProjectSources([]);
      setOpenPrTotal(0);
    }, [projectId]);

    useBindStoreRefresh(useWorkStore.getState(), loadWork);

    useImperativeHandle(ref, () => ({ loadWork }), [loadWork]);

    async function runAttentionRecheck(item: WorkItem) {
      setAttentionBusyId(item.id);
      onError("");
      onNotice("");
      try {
        const result = await recheckWorkItem(item.id);
        await loadWork();
        if (result.status === "terminal") {
          onNotice(`Verified ${item.title} as ${result.work.delivery}`);
        } else if (result.status === "active") {
          onNotice(`${item.title} is active in the source again`);
        } else {
          onError(
            result.detail ??
              "Source could not confirm the final state. You can open it upstream or mark it resolved.",
          );
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : "Recheck failed");
      } finally {
        setAttentionBusyId("");
      }
    }

    async function runAttentionRetrySource(item: WorkItem) {
      if (!item.sourceId) return;
      setAttentionBusyId(item.id);
      onError("");
      onNotice("");
      try {
        await refreshProjectSource(projectId, item.sourceId);
        await loadWork();
        onNotice(`Retried source ${sourceLabel(item)}`);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Source retry failed");
      } finally {
        setAttentionBusyId("");
      }
    }

    function openResolveDialog(item: WorkItem) {
      setResolveTarget(item);
      setResolveOpen(true);
    }

    async function confirmResolve() {
      const item = resolveTarget;
      if (!item) return;
      setAttentionBusyId(item.id);
      onError("");
      onNotice("");
      try {
        await resolveWorkItem(item.id, {
          note: "Marked resolved from project Needs attention",
        });
        setResolveOpen(false);
        setResolveTarget(null);
        await loadWork();
        onNotice(
          `Resolved ${item.title}. It will reappear if the source reports it active again.`,
        );
      } catch (err) {
        onError(err instanceof Error ? err.message : "Resolve failed");
      } finally {
        setAttentionBusyId("");
      }
    }

    async function onAttentionAction(item: WorkItem, actionId: string) {
      if (actionId === "recheck-item") {
        await runAttentionRecheck(item);
        return;
      }
      if (actionId === "retry-source") {
        await runAttentionRetrySource(item);
        return;
      }
      if (actionId === "resolve") {
        openResolveDialog(item);
        return;
      }
      if (actionId === "open-source") {
        const href = attentionHref(item);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
      }
    }

    async function runPrimaryAttentionAction(item: WorkItem) {
      const action = primaryAttentionAction(item);
      if (!action || action.kind === "route" || action.kind === "href") return;
      if (action.id === "recheck-item") {
        await runAttentionRecheck(item);
        return;
      }
      if (action.id === "retry-source") {
        await runAttentionRetrySource(item);
      }
    }

    async function runMergeBabysitter() {
      if (!mergeBabysitter) return;
      setMergeBusy(true);
      onError("");
      try {
        const run = await runAgent(mergeBabysitter.id);
        navigate(`/runs/${run.id}`);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to enqueue merge babysitter");
        setMergeBusy(false);
      }
    }

    return (
      <>
        <section className="panel mb-7">
          <div className="panel-header impact-header">
            <span>Project command center</span>
            <span className="muted text-sm">
              {workStatus?.asOf
                ? `Observed ${new Date(workStatus.asOf).toLocaleString()}`
                : "Awaiting source observations"}
            </span>
          </div>
          <div className="panel-body">
            <StatGrid>
              <StatTile
                metricKey="work.working"
                value={workStatus?.working ?? 0}
                previous={workStatus?.previous?.working}
                compareLabel={workCompareLabelStr()}
              />
              <StatTile
                metricKey="work.queued"
                value={workStatus?.queued ?? 0}
                previous={workStatus?.previous?.queued}
                compareLabel={workCompareLabelStr()}
              />
              <StatTile
                metricKey="work.needsAttention"
                value={workStatus?.needsAttention ?? 0}
                previous={workStatus?.previous?.needsAttention}
                compareLabel={workCompareLabelStr()}
              />
              <StatTile
                metricKey="work.verifiedOpen"
                value={workStatus?.verifiedOpen ?? 0}
                previous={workStatus?.previous?.verifiedOpen}
                compareLabel={workCompareLabelStr()}
              />
              <StatTile
                metricKey="work.staleOpen"
                value={workStatus?.staleOpen ?? 0}
                previous={workStatus?.previous?.staleOpen}
                compareLabel={workCompareLabelStr()}
              />
            </StatGrid>
            <ProjectSourcesPanel sources={projectSources} />
          </div>
        </section>

        <section className="list-section">
          <div className="list-section__header">
            <h2 className="list-section__title">Now</h2>
            <span className="list-section__meta">{nowWork.length}</span>
          </div>
          {nowWork.length === 0 ? (
            <div className="muted text-sm">No active or queued work</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Work</th>
                    <th>Agent / profile</th>
                    <th>Phase</th>
                    <th>Platform / repo</th>
                    <th>Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {nowWork.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.kind === "run" && item.nativeKey ? (
                          <Link
                            to={`/runs/${item.nativeKey}`}
                            className="entity-name"
                          >
                            {workPrimaryLabel(item)}
                          </Link>
                        ) : item.webUrl ? (
                          <a
                            href={item.webUrl}
                            className="entity-name"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {workPrimaryLabel(item)}
                          </a>
                        ) : (
                          <span>{workPrimaryLabel(item)}</span>
                        )}
                        {workSecondaryLabel(item) ? (
                          <div className="muted text-sm">
                            {workSecondaryLabel(item)}
                          </div>
                        ) : null}
                      </td>
                      <td>{workAgentProfileLabel(item)}</td>
                      <td>
                        <ExecutionBadge execution={item.execution} />
                      </td>
                      <td>{sourceLabel(item)}</td>
                      <td className="mono muted">{observedLabel(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {attentionWork.length > 0 ? (
          <section className="list-section">
            <div className="list-section__header">
              <h2 className="list-section__title">Needs attention</h2>
              <span className="list-section__meta">{attentionWork.length}</span>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Work</th>
                    <th>Reason</th>
                    <th>Source</th>
                    <th>Last observation</th>
                    <th>Recommended</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionWork.map((item) => {
                    const action = primaryAttentionAction(item);
                    const href = attentionHref(item);
                    return (
                      <tr key={item.id}>
                        <td>
                          {item.kind === "run" && item.nativeKey ? (
                            <Link
                              to={`/runs/${item.nativeKey}`}
                              className="entity-name"
                            >
                              {item.title}
                            </Link>
                          ) : href ? (
                            <a
                              href={href}
                              className="entity-name"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {item.title}
                            </a>
                          ) : (
                            <span>{item.title}</span>
                          )}
                          {item.summary ? (
                            <div className="muted text-sm">{item.summary}</div>
                          ) : null}
                        </td>
                        <td>
                          <AttentionBadge attention={item.attention} />
                          {item.lastError ? (
                            <div className="muted text-sm">{item.lastError}</div>
                          ) : null}
                        </td>
                        <td>{sourceLabel(item)}</td>
                        <td className="mono muted">{observedLabel(item)}</td>
                        <td>
                          {action?.kind === "route" ? (
                            <AppButton
                              variant="primary"
                              size="sm"
                              to={action.to}
                              iconBefore={<Play size={12} />}
                            >
                              {action.label}
                            </AppButton>
                          ) : action?.kind === "href" ? (
                            <AppButton
                              size="sm"
                              href={action.href}
                              target="_blank"
                              iconBefore={<ExternalLink size={12} />}
                            >
                              {action.label}
                            </AppButton>
                          ) : action?.kind === "action" ? (
                            <AppButton
                              variant="primary"
                              size="sm"
                              loading={attentionBusyId === item.id}
                              loadingLabel="Working…"
                              onClick={() => void runPrimaryAttentionAction(item)}
                              iconBefore={<RefreshCw size={12} />}
                            >
                              {action.label}
                            </AppButton>
                          ) : (
                            <span className="muted text-sm">No action available</span>
                          )}
                        </td>
                        <td className="actions-col">
                          <ActionMenu
                            items={attentionActions(item)}
                            disabled={attentionBusyId === item.id}
                            label={`Actions for ${item.title}`}
                            onSelect={(id) => void onAttentionAction(item, id)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section id="delivery" className="panel mb-7">
          <div className="panel-header impact-header">
            <span>
              Delivery
              <span className="list-section__meta">· {deliveryWork.length}</span>
            </span>
            {mergeBabysitter && openPrTotal > 0 ? (
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
            ) : null}
          </div>
          <div
            className={
              deliveryWork.length > 0
                ? "panel-body panel-body--flush-table"
                : "panel-body"
            }
          >
            {deliveryWork.length === 0 ? (
              <div className="muted text-sm">No active delivery work</div>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Work</th>
                      <th>State</th>
                      <th>Provenance</th>
                      <th>Source</th>
                      <th>Observed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryWork.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.webUrl ? (
                            <a
                              href={item.webUrl}
                              className="entity-name"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {item.title}
                            </a>
                          ) : (
                            <span>{item.title}</span>
                          )}
                          {item.labels.length > 0 ? (
                            <div className="muted text-sm">
                              {item.labels.join(" · ")}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <DeliveryBadge delivery={item.delivery} />
                        </td>
                        <td>
                          <ProvenanceBadge provenance={item.provenance} />
                        </td>
                        <td>{sourceLabel(item)}</td>
                        <td className="mono muted">
                          {observedLabel(item)}{" "}
                          <SyncStateBadge syncState={item.syncState} showLabel={false} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

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
            Remove <strong>{resolveTarget?.title}</strong> from Needs attention and keep it
            in History.
          </p>
          <p className="muted mt-3">
            This does not invent a merged or closed delivery. If the source later reports the
            work as active again, gojo will restore it to the command center.
          </p>
        </ConfirmDialog>
      </>
    );
  },
);
