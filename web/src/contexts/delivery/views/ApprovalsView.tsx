import { useState } from "react";
import { Check, FileDiff, Pause, RefreshCw, X } from "lucide-react";

import {
  listApprovals,
  updateApproval,
  useDeliveryStore,
} from "@/contexts/delivery/contract";
import { getWorkDiff } from "@/contexts/work/contract";
import { AppButton } from "@/ui/AppButton";
import { PageHeader } from "@/ui/PageHeader";
import { StatusBadge } from "@/ui/StatusBadge";
import { TablePager } from "@/ui/TablePager";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useServerTable } from "@/platform/useServerTable";
import { approvalStatus } from "@/kernel/status-icons";
import type { Approval, ApprovalState } from "@/contexts/delivery/types";

export function ApprovalsView() {
  const [actionableOnly, setActionableOnly] = useState(true);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<{ id: string; action: string } | null>(null);
  const [openDiffId, setOpenDiffId] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");

  const stateFilter: ApprovalState | undefined = actionableOnly ? "awaiting-human" : undefined;

  const table = useServerTable({
    defaultSort: "updatedAt",
    defaultOrder: "desc",
    watchSources: [actionableOnly],
    fetchPage: ({ limit, offset }) =>
      listApprovals({ limit, offset, state: stateFilter }),
  });

  useBindStoreRefresh(useDeliveryStore.getState(), table.load);

  function isBusy(approval: Approval, action: string) {
    return busy?.id === approval.id && busy.action === action;
  }

  async function act(approval: Approval, action: "approve" | "reject" | "hold") {
    setBusy({ id: approval.id, action });
    setActionError("");
    try {
      await updateApproval(approval.id, action);
      await table.load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function toggleDiff(approval: Approval) {
    if (openDiffId === approval.id) {
      setOpenDiffId(null);
      setDiffText("");
      return;
    }
    if (!approval.workItemId) return;
    setBusy({ id: approval.id, action: "diff" });
    setActionError("");
    try {
      const text = await getWorkDiff(approval.workItemId);
      setDiffText(text);
      setOpenDiffId(approval.id);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Review settled checks and control platform-owned merges."
        actions={
          <>
            <AppButton
              variant="ghost"
              selected={actionableOnly}
              onClick={() => setActionableOnly((v) => !v)}
              iconBefore={<Check size={16} />}
            >
              Needs action
            </AppButton>{" "}
            <AppButton
              loading={table.loading}
              loadingLabel="Refreshing…"
              onClick={() => void table.load()}
              iconBefore={<RefreshCw size={16} />}
            >
              Refresh
            </AppButton>
          </>
        }
      />

      {table.error || actionError ? (
        <p className="error">{actionError || table.error}</p>
      ) : !table.loading && table.items.length === 0 ? (
        <p className="empty-state">No approvals match this view.</p>
      ) : null}

      <div className="approval-grid">
        {table.items.map((approval) => {
          const spec = approvalStatus(approval.state);
          return (
            <article key={approval.id} className="approval-card">
              <div className="approval-card__header">
                <div>
                  <div className="eyebrow">
                    {approval.projectName || approval.projectId}
                    {approval.agentName ? <span> · {approval.agentName}</span> : null}
                  </div>
                  <h2>
                    {approval.workTitle || approval.reason || approval.subjectId}
                  </h2>
                </div>
                <StatusBadge label={spec.label} tone={spec.tone} />
              </div>

              <dl className="approval-evidence">
                <div>
                  <dt>Checks</dt>
                  <dd>{approval.checksState || "unknown"}</dd>
                </div>
                <div>
                  <dt>Review</dt>
                  <dd>{approval.reviewVerdict || "pending"}</dd>
                </div>
                <div>
                  <dt>Authority</dt>
                  <dd>
                    {approval.autonomy}
                    {approval.autonomyMismatch && approval.agentAutonomy ? (
                      <span
                        className="authority-mismatch"
                        title={`Agent config is now ${approval.agentAutonomy}; this approval still has ${approval.autonomy} from when the PR opened.`}
                      >
                        {" "}
                        (agent: {approval.agentAutonomy})
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>Fix rounds</dt>
                  <dd>{approval.attempts}</dd>
                </div>
              </dl>

              {approval.autonomyMismatch && approval.agentAutonomy ? (
                <p className="hint">
                  Snapshotted authority differs from the agent's current{" "}
                  <code>approval: {approval.agentAutonomy}</code>. Use{" "}
                  <code>gojo approval set-autonomy</code> to catch up open rows.
                </p>
              ) : null}
              {approval.lastError ? (
                <p className="error">{approval.lastError}</p>
              ) : null}
              {openDiffId === approval.id ? (
                <pre className="approval-diff">{diffText}</pre>
              ) : null}

              <div className="approval-card__actions">
                {approval.workItemId ? (
                  <AppButton
                    size="sm"
                    loading={isBusy(approval, "diff")}
                    loadingLabel="Loading diff…"
                    onClick={() => void toggleDiff(approval)}
                    iconBefore={<FileDiff size={12} />}
                  >
                    {openDiffId === approval.id ? "Hide diff" : "View diff"}
                  </AppButton>
                ) : null}
                {approval.workUrl ? (
                  <AppButton
                    size="sm"
                    href={approval.workUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    iconBefore={<FileDiff size={12} />}
                  >
                    Open source
                  </AppButton>
                ) : null}
                {approval.state === "awaiting-human" ? (
                  <AppButton
                    variant="primary"
                    size="sm"
                    loading={isBusy(approval, "approve")}
                    loadingLabel="Approving…"
                    onClick={() => void act(approval, "approve")}
                    iconBefore={<Check size={12} />}
                  >
                    Approve
                  </AppButton>
                ) : null}
                {approval.state !== "applied" && approval.state !== "rejected" ? (
                  <AppButton
                    size="sm"
                    loading={isBusy(approval, "hold")}
                    loadingLabel="Holding…"
                    onClick={() => void act(approval, "hold")}
                    iconBefore={<Pause size={12} />}
                  >
                    Hold
                  </AppButton>
                ) : null}
                {approval.state !== "applied" && approval.state !== "rejected" ? (
                  <AppButton
                    variant="danger"
                    size="sm"
                    loading={isBusy(approval, "reject")}
                    loadingLabel="Rejecting…"
                    onClick={() => void act(approval, "reject")}
                    iconBefore={<X size={12} />}
                  >
                    Reject
                  </AppButton>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <TablePager
        page={table.page}
        pageCount={table.pages}
        rangeLabel={table.rangeLabel}
        total={table.total}
        onPageChange={table.setPage}
        loading={table.loading}
      />
    </div>
  );
}
