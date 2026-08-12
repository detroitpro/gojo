import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { Ban, Check, RotateCcw, X } from "lucide-react";

import {
  approveRun,
  cancelRun,
  getRun,
  getRunArtifacts,
  getRunDiff,
  rejectRun,
  retryRun,
  subscribeRunEvents,
} from "@/contexts/execution/contract";
import { AppButton } from "@/ui/AppButton";
import { PageHeader } from "@/ui/PageHeader";
import { RunActivitySection } from "@/contexts/execution/components/RunActivitySection";
import {
  RunArtifactsSection,
  type HandoffAssetView,
} from "@/contexts/execution/components/RunArtifactsSection";
import { SortableTh } from "@/ui/SortableTh";
import { IntegrationStatusBadge } from "@/ui/status/IntegrationStatusBadge";
import { VerificationBadge } from "@/ui/status/VerificationBadge";
import { StateBadge } from "@/ui/StateBadge";
import { StatusBadge } from "@/ui/StatusBadge";
import { TablePager } from "@/ui/TablePager";
import { useClientPager } from "@/platform/useClientPager";
import { useSoftLoading } from "@/platform/useSoftLoading";
import {
  durationBetween,
  fmtCost,
  fmtDuration,
  fmtTime,
  fmtTokens,
  shortSha,
} from "@/kernel/format";
import { impactCategoryLabel } from "@/kernel/impact-format";
import { approvalStatus } from "@/kernel/status-icons";
import type { PhaseKey } from "@/kernel/run-phases";
import { isTerminalRunState } from "@gojo/contracts/types";
import type {
  Attempt,
  Run,
  RunArtifactsResult,
  RunEvent,
  RunImpactItem,
  RunIntegration,
} from "@/contexts/execution/types";
import type { Approval } from "@/contexts/delivery/types";

export function RunDetailView() {
  const { id: runId = "" } = useParams();
  const navigate = useNavigate();

  const [run, setRun] = useState<Run | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [impactItems, setImpactItems] = useState<RunImpactItem[]>([]);
  const [integration, setIntegration] = useState<RunIntegration | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [diffFiles, setDiffFiles] = useState<string[] | null>(null);
  const [artifacts, setArtifacts] = useState<RunArtifactsResult | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<PhaseKey | null>(null);
  const [highlightActivityId, setHighlightActivityId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const durationTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const soft = useSoftLoading(Boolean(run));

  const runIsActive = Boolean(run?.state && !isTerminalRunState(run.state));

  useEffect(() => {
    if (runIsActive) {
      setNowMs(Date.now());
      if (durationTickRef.current === null) {
        durationTickRef.current = setInterval(() => setNowMs(Date.now()), 1000);
      }
    } else if (durationTickRef.current !== null) {
      clearInterval(durationTickRef.current);
      durationTickRef.current = null;
    }
    return () => {
      if (durationTickRef.current !== null) {
        clearInterval(durationTickRef.current);
        durationTickRef.current = null;
      }
    };
  }, [runIsActive]);

  const attemptPager = useClientPager(attempts, 25, {
    defaultSort: "attemptNumber",
    defaultOrder: "asc",
  });

  const load = useCallback(async () => {
    setError("");
    try {
      await soft.run(async () => {
        const data = await getRun(runId);
        setRun(data.run);
        setAttempts(data.attempts);
        setImpactItems(data.impactItems ?? []);
        setIntegration(data.integration ?? null);
        setApproval(data.approval ?? null);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run");
    }
  }, [runId, soft.run]);

  const loadInspect = useCallback(async () => {
    try {
      const [diff, arts] = await Promise.all([
        getRunDiff(runId).catch(() => ({ files: [] as string[] })),
        getRunArtifacts(runId),
      ]);
      setDiffFiles(diff.files);
      setArtifacts(arts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inspect data");
    }
  }, [runId]);

  const startEvents = useCallback(() => {
    unsubscribeRef.current?.();
    setEvents([]);
    unsubscribeRef.current = subscribeRunEvents(runId, (event) => {
      setEvents((prev) => {
        if (event.id != null && prev.some((e) => e.id === event.id)) return prev;
        return [...prev, event];
      });

      if (
        event.type === "run.state_changed" &&
        event.data &&
        typeof event.data === "object"
      ) {
        const data = event.data as { to?: string };
        setRun((prev) => {
          if (!prev || !data.to) return prev;
          const next: Run = { ...prev, state: data.to as Run["state"] };
          if (!next.startedAt && (data.to === "Preparing" || data.to === "Running")) {
            next.startedAt = event.at || new Date().toISOString();
          }
          return next;
        });
      }

      if (event.type === "run.failed" && event.data && typeof event.data === "object") {
        const data = event.data as { error?: string };
        setRun((prev) =>
          prev
            ? {
                ...prev,
                state: "Failed",
                errorMessage: data.error ?? prev.errorMessage,
              }
            : prev,
        );
      }

      if (event.type === "run.agent.model" && event.data && typeof event.data === "object") {
        const model = (event.data as { model?: string }).model;
        setAttempts((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (!model || last.model) return prev;
          return prev.map((a, i) => (i === prev.length - 1 ? { ...a, model } : a));
        });
      }

      if (event.type === "run.agent.finished") {
        void load();
      }

      if (event.type === "run.finished") {
        setRun((prev) => {
          if (!prev) return prev;
          const data =
            event.data && typeof event.data === "object"
              ? (event.data as { state?: string })
              : {};
          return {
            ...prev,
            ...(data.state ? { state: data.state as Run["state"] } : {}),
            finishedAt: event.at || new Date().toISOString(),
          };
        });
        void load();
        void loadInspect();
      }
    });
  }, [runId, load, loadInspect]);

  useEffect(() => {
    setRun(null);
    setAttempts([]);
    setImpactItems([]);
    setIntegration(null);
    setApproval(null);
    setEvents([]);
    void load();
    startEvents();
    void loadInspect();
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const handoffText = useMemo(() => {
    const latest = attempts.at(-1);
    if (!latest?.handoffJson) return null;
    try {
      return JSON.stringify(JSON.parse(latest.handoffJson), null, 2);
    } catch {
      return latest.handoffJson;
    }
  }, [attempts]);

  const prUrl = useMemo(() => {
    for (let i = attempts.length - 1; i >= 0; i -= 1) {
      const url = attempts[i]?.prUrl;
      if (url) return url;
    }
    const handoff = artifacts?.handoff;
    if (handoff && typeof handoff === "object") {
      const raw = (handoff as { prUrl?: unknown }).prUrl;
      if (typeof raw === "string" && raw.trim()) return raw.trim();
    }
    return null;
  }, [attempts, artifacts]);

  const prUrlIsPlaceholder = prUrl?.startsWith("local://pr/") ?? false;

  const artifactsHandoffText = useMemo(() => {
    if (!artifacts?.handoff) return null;
    try {
      return JSON.stringify(artifacts.handoff, null, 2);
    } catch {
      return String(artifacts.handoff);
    }
  }, [artifacts]);

  const artifactsValidationText = useMemo(() => {
    if (!artifacts?.validation) return null;
    try {
      return JSON.stringify(artifacts.validation, null, 2);
    } catch {
      return String(artifacts.validation);
    }
  }, [artifacts]);

  const handoffAssets = useMemo<HandoffAssetView[]>(() => {
    const handoff = artifacts?.handoff;
    if (!handoff || typeof handoff !== "object") return [];
    const raw = (handoff as { assets?: unknown }).assets;
    if (!Array.isArray(raw)) return [];
    const out: HandoffAssetView[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.role !== "string") continue;
      out.push({
        role: obj.role,
        label:
          typeof obj.label === "string" && obj.label.trim() ? obj.label.trim() : obj.role,
        ...(typeof obj.path === "string" ? { path: obj.path } : {}),
        mediaType:
          typeof obj.mediaType === "string" && obj.mediaType.trim()
            ? obj.mediaType.trim()
            : "text/markdown",
        ...(typeof obj.content === "string" ? { content: obj.content } : {}),
      });
    }
    return out;
  }, [artifacts]);

  const runDurationMs = useMemo(() => {
    const start = run?.startedAt ?? run?.createdAt;
    if (!start) return null;
    if (run?.finishedAt) return durationBetween(start, run.finishedAt);
    const startMs = Date.parse(start);
    if (!Number.isFinite(startMs)) return null;
    return Math.max(0, nowMs - startMs);
  }, [run, nowMs]);

  const costSummary = useMemo(() => {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let cost = 0;
    let hasCost = false;
    let source: string | null = null;
    let model: string | null = null;

    for (const attempt of attempts) {
      input += attempt.inputTokens ?? 0;
      output += attempt.outputTokens ?? 0;
      cacheRead += attempt.cacheReadTokens ?? 0;
      cacheWrite += attempt.cacheWriteTokens ?? 0;
      if (attempt.totalCostUsd != null) {
        cost += attempt.totalCostUsd;
        hasCost = true;
        source = attempt.costSource ?? source;
      }
      if (attempt.model) model = attempt.model;
    }

    for (const event of events) {
      if (
        event.type === "run.agent.model" &&
        event.data &&
        typeof event.data === "object"
      ) {
        const m = (event.data as { model?: string }).model;
        if (m) model = m;
      }
    }

    for (const event of events) {
      if (
        event.type !== "run.agent.finished" ||
        !event.data ||
        typeof event.data !== "object"
      )
        continue;
      const usage = (
        event.data as {
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
            totalCostUsd?: number | null;
            costSource?: string;
            model?: string;
          } | null;
        }
      ).usage;
      if (!usage) continue;
      if (!hasCost) {
        input = usage.inputTokens ?? input;
        output = usage.outputTokens ?? output;
        cacheRead = usage.cacheReadTokens ?? cacheRead;
        cacheWrite = usage.cacheWriteTokens ?? cacheWrite;
        if (usage.totalCostUsd != null) {
          cost = usage.totalCostUsd;
          hasCost = true;
          source = usage.costSource ?? source;
        }
      }
      if (usage.model) model = usage.model;
    }

    const runActive = run
      ? !["Succeeded", "Failed", "Canceled", "TimedOut", "Abandoned"].includes(run.state)
      : false;

    return {
      input,
      output,
      cacheRead,
      cacheWrite,
      cost: hasCost ? cost : null,
      source,
      model,
      pendingUsage: runActive && !hasCost,
    };
  }, [attempts, events, run]);

  const canCancel = run
    ? !["Succeeded", "Failed", "Canceled", "TimedOut", "Abandoned"].includes(run.state)
    : false;
  const canApprove = run?.state === "AwaitingApproval";
  const canRetry = run
    ? ["Failed", "Canceled", "TimedOut", "InfrastructureFailure", "Conflict"].includes(
        run.state,
      )
    : false;

  async function doCancel() {
    setBusy(true);
    try {
      setRun(await cancelRun(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }
  async function doApprove() {
    setBusy(true);
    try {
      setRun(await approveRun(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }
  async function doReject() {
    setBusy(true);
    try {
      setRun(await rejectRun(runId, rejectReason || undefined));
      setRejectReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusy(false);
    }
  }
  async function doRetry() {
    setBusy(true);
    setError("");
    try {
      const next = await retryRun(runId);
      navigate(`/runs/${next.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  }

  function attemptDuration(attempt: Attempt): string {
    return fmtDuration(durationBetween(attempt.startedAt, attempt.finishedAt));
  }

  function impactEvidence(item: RunImpactItem): string {
    try {
      const parsed = JSON.parse(item.evidenceJson) as {
        files?: string[];
        references?: string[];
      };
      const parts = [...(parsed.files ?? []), ...(parsed.references ?? [])];
      return parts.join(", ");
    } catch {
      return "";
    }
  }

  const attemptItems = attempts.slice(
    attemptPager.offset,
    attemptPager.offset + attemptPager.pageSize,
  );

  return (
    <div>
      <PageHeader
        title={run?.agentName || `Run ${runId.slice(0, 14)}…`}
        subtitle={
          run ? (
            <div className="subtitle run-meta">
              <StateBadge state={run.state} />
              <span className="muted">{run.projectName || "Unknown project"}</span>
              <span className="muted">·</span>
              <span className="muted">{run.trigger}</span>
              <span className="muted">·</span>
              <span className="mono muted">{fmtDuration(runDurationMs)}</span>
              {run.startedAt ? (
                <span className="muted"> · started {fmtTime(run.startedAt)}</span>
              ) : null}
              <span className="muted">·</span>
              <span className="mono muted" title={run.id}>
                {run.id.slice(0, 12)}…
              </span>
            </div>
          ) : null
        }
        actions={
          canCancel || canApprove || canRetry ? (
            <>
              {canCancel ? (
                <AppButton
                  variant="danger"
                  loading={busy}
                  loadingLabel="Working…"
                  onClick={() => void doCancel()}
                  iconBefore={<Ban size={16} />}
                >
                  Cancel
                </AppButton>
              ) : null}{" "}
              {canApprove ? (
                <AppButton
                  variant="primary"
                  loading={busy}
                  loadingLabel="Working…"
                  onClick={() => void doApprove()}
                  iconBefore={<Check size={16} />}
                >
                  Approve
                </AppButton>
              ) : null}{" "}
              {canRetry ? (
                <AppButton
                  loading={busy}
                  loadingLabel="Working…"
                  onClick={() => void doRetry()}
                  iconBefore={<RotateCcw size={16} />}
                >
                  Retry
                </AppButton>
              ) : null}
            </>
          ) : null
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {soft.loading && !run ? <div className="empty">Loading…</div> : null}

      {run ? (
        <>
          {run.errorMessage ? (
            <div className="alert alert-error mb-4">{run.errorMessage}</div>
          ) : null}
          {prUrl ? (
            <div
              className={`alert mb-4 ${prUrlIsPlaceholder ? "alert-error" : "alert-info"}`}
            >
              <span className="muted">Pull request:</span>{" "}
              {!prUrlIsPlaceholder ? (
                <a
                  className="mono"
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {prUrl}
                </a>
              ) : (
                <span className="mono">{prUrl}</span>
              )}
              {prUrlIsPlaceholder ? (
                <span className="muted">
                  {" "}
                  (PR CLI did not create a remote PR — branch may still be pushed)
                </span>
              ) : null}
            </div>
          ) : null}

          <section className="panel cost-panel">
            <div className="panel-header">Cost &amp; usage</div>
            <div className="panel-body cost-grid">
              <div>
                <div className="cost-label">Cost</div>
                <div className="cost-value mono">
                  {fmtCost(costSummary.cost, costSummary.source)}
                </div>
                <div className="muted cost-hint">
                  {costSummary.source === "reported"
                    ? "Reported by agent CLI"
                    : costSummary.source === "estimated"
                      ? "Estimated from tokens × model rates"
                      : costSummary.pendingUsage
                        ? "Tokens/cost finalize when the agent finishes"
                        : "No usage reported yet"}
                </div>
              </div>
              <div>
                <div className="cost-label">Tokens</div>
                <div className="cost-value mono">
                  {fmtTokens(costSummary.input)} in · {fmtTokens(costSummary.output)} out
                </div>
                <div className="muted cost-hint">
                  {costSummary.pendingUsage ? (
                    "Pending until agent finishes"
                  ) : (
                    <>
                      cache r/w {fmtTokens(costSummary.cacheRead)} /{" "}
                      {fmtTokens(costSummary.cacheWrite)}
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="cost-label">Model</div>
                <div className="cost-value mono">{costSummary.model ?? "—"}</div>
              </div>
            </div>
          </section>

          {integration || approval || impactItems.length > 0 ? (
            <section className="panel">
              <div className="panel-header">Impact &amp; integration</div>
              <div className="panel-body">
                {integration ? (
                  <div className="integration-summary">
                    <IntegrationStatusBadge status={integration.status} />
                    <span className="mono muted">{integration.mode}</span>
                    {integration.prUrl && !integration.prUrl.startsWith("local://") ? (
                      <a
                        className="mono"
                        href={integration.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {integration.repo
                          ? `${integration.repo}#${integration.prNumber}`
                          : "PR"}
                      </a>
                    ) : null}
                    {integration.mergedAt ? (
                      <span className="muted">
                        merged {fmtTime(integration.mergedAt)}
                      </span>
                    ) : integration.closedAt ? (
                      <span className="muted">
                        closed {fmtTime(integration.closedAt)}
                      </span>
                    ) : integration.status === "open" && integration.nextCheckAt ? (
                      <span className="muted">
                        next merge check {fmtTime(integration.nextCheckAt)}
                      </span>
                    ) : null}
                    {integration.lastError ? (
                      <span className="muted" title={integration.lastError}>
                        · last check failed
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {approval ? (
                  <div className="integration-summary mt-4">
                    <StatusBadge
                      label={approvalStatus(approval.state).label}
                      tone={approvalStatus(approval.state).tone}
                    />
                    <AppButton
                      size="sm"
                      to="/approvals"
                      iconBefore={<Check size={12} />}
                    >
                      Open approval
                    </AppButton>
                  </div>
                ) : null}

                {impactItems.length > 0 ? (
                  <div className={`table-wrap${integration ? " mt-4" : ""}`}>
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Subject</th>
                          <th>Summary</th>
                          <th>Source</th>
                          <th>Trust</th>
                          <th>Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {impactItems.map((item) => (
                          <tr key={item.id}>
                            <td>{impactCategoryLabel(item.category)}</td>
                            <td className="mono">{item.subject}</td>
                            <td>{item.summary}</td>
                            <td className="muted">{item.source}</td>
                            <td>
                              <VerificationBadge verification={item.verification} />
                            </td>
                            <td className="mono muted text-sm">
                              {impactEvidence(item) || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="muted">No impact items recorded for this run</div>
                )}
              </div>
            </section>
          ) : null}

          {canApprove ? (
            <div className="panel">
              <div className="panel-header">Approval required</div>
              <div className="panel-body">
                <div className="inline-form">
                  <div className="field flex-2">
                    <label htmlFor="reason">Reject reason (optional)</label>
                    <Textfield
                      id="reason"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.currentTarget.value)}
                      placeholder="Policy violation…"
                    />
                  </div>
                  <AppButton
                    variant="danger"
                    loading={busy}
                    loadingLabel="Working…"
                    onClick={() => void doReject()}
                    iconBefore={<X size={12} />}
                  >
                    Reject
                  </AppButton>
                </div>
              </div>
            </div>
          ) : null}

          <RunActivitySection
            events={events}
            selectedPhase={selectedPhase}
            highlightActivityId={highlightActivityId}
            onSelectedPhaseChange={setSelectedPhase}
            onHighlightActivityIdChange={setHighlightActivityId}
          />

          <section className="panel">
            <div className="panel-header">Diff</div>
            <div className="panel-body">
              {diffFiles === null ? (
                <div className="muted">Loading…</div>
              ) : diffFiles.length === 0 ? (
                <div className="muted">
                  No changed files (or workspace unavailable)
                </div>
              ) : (
                <ul className="mono">
                  {diffFiles.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <RunArtifactsSection
            run={run}
            artifacts={artifacts}
            handoffText={handoffText}
            handoffAssets={handoffAssets}
            artifactsHandoffText={artifactsHandoffText}
            artifactsValidationText={artifactsValidationText}
          />

          <section className="list-section">
            <div className="list-section__header">
              <h2 className="list-section__title">Attempts</h2>
              <span className="list-section__meta">{attempts.length}</span>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <SortableTh
                      column="attemptNumber"
                      label="#"
                      sort={attemptPager.sort}
                      order={attemptPager.order}
                      onSort={attemptPager.setSort}
                    />
                    <SortableTh
                      column="state"
                      label="State"
                      sort={attemptPager.sort}
                      order={attemptPager.order}
                      onSort={attemptPager.setSort}
                    />
                    <SortableTh
                      column="exitCode"
                      label="Exit"
                      sort={attemptPager.sort}
                      order={attemptPager.order}
                      onSort={attemptPager.setSort}
                    />
                    <th>Duration</th>
                    <SortableTh
                      column="totalCostUsd"
                      label="Cost"
                      sort={attemptPager.sort}
                      order={attemptPager.order}
                      defaultOrder="desc"
                      onSort={attemptPager.setSort}
                    />
                    <th>Tokens</th>
                    <SortableTh
                      column="model"
                      label="Model"
                      sort={attemptPager.sort}
                      order={attemptPager.order}
                      onSort={attemptPager.setSort}
                    />
                    <th>Start</th>
                    <th>Result</th>
                    <th>Branch</th>
                    <th>PR</th>
                  </tr>
                </thead>
                <tbody>
                  {attemptItems.map((attempt) => (
                    <tr key={attempt.id}>
                      <td className="mono">{attempt.attemptNumber}</td>
                      <td className="mono">{attempt.state}</td>
                      <td className="mono">{attempt.exitCode ?? "—"}</td>
                      <td className="mono muted">{attemptDuration(attempt)}</td>
                      <td className="mono">
                        {fmtCost(attempt.totalCostUsd, attempt.costSource)}
                      </td>
                      <td className="mono muted">
                        {fmtTokens(attempt.inputTokens)}/
                        {fmtTokens(attempt.outputTokens)}
                      </td>
                      <td className="mono muted">{attempt.model ?? "—"}</td>
                      <td
                        className="mono muted"
                        title={attempt.startingCommit ?? undefined}
                      >
                        {shortSha(attempt.startingCommit)}
                      </td>
                      <td
                        className="mono muted"
                        title={attempt.resultCommit ?? undefined}
                      >
                        {shortSha(attempt.resultCommit)}
                      </td>
                      <td className="mono muted">{attempt.branchName ?? "—"}</td>
                      <td
                        className="mono muted"
                        title={attempt.prUrl ?? undefined}
                      >
                        {attempt.prUrl && !attempt.prUrl.startsWith("local://") ? (
                          <a
                            href={attempt.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            PR
                          </a>
                        ) : attempt.prUrl ? (
                          <span>local</span>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePager
                page={attemptPager.page + 1}
                pageCount={attemptPager.pageCount}
                rangeLabel={attemptPager.rangeLabel}
                total={attempts.length}
                onPageChange={(p) => attemptPager.setPage(p - 1)}
              />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
