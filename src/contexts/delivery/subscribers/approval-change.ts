import { ulid } from "ulid";

import type { UserService } from "@/contexts/access/contract";
import type { PlatformChangeFeed } from "@/platform/events/platform-change-feed";
import type { RunEventBus } from "@/contexts/execution/contract";
import type { WorkRepositories } from "@/contexts/work/contract";
import type { Approval } from "@shared/approvals";

/**
 * Delivery-context subscriber that reacts to approval state changes.
 *
 * Kept intentionally in the delivery context so `app/context.ts` no longer
 * inlines this policy (topic names, approve-link generation, event shape).
 * `createAppContext` just wires the callback to `ApprovalService`.
 */
export interface ApprovalChangeDeps {
  users: UserService;
  work: WorkRepositories;
  platformEvents: PlatformChangeFeed;
  eventBus: RunEventBus;
  apiBaseUrl: string | null;
}

export function createApprovalChangeHandler(
  deps: ApprovalChangeDeps,
): (approval: Approval) => void {
  const { users, work, platformEvents, eventBus, apiBaseUrl } = deps;

  return (approval: Approval) => {
    platformEvents.append({
      projectId: approval.projectId,
      type: "approval.updated",
      entityKind: "approval",
      entityId: approval.id,
      topics: ["dashboard", "work", "runs"],
      data: { state: approval.state, subjectId: approval.subjectId },
    });

    if (approval.state !== "awaiting-human" || !approval.runId) {
      return;
    }

    const admin = users.findFirstAdmin();
    const approvalToken =
      admin && apiBaseUrl
        ? users.createApiTokenForUser(
            admin.id,
            `approval-link-${approval.id}-${ulid()}`,
            {
              expiresAt: new Date(
                Date.now() + 24 * 60 * 60 * 1000,
              ).toISOString(),
              scopes: [`control:approve:${approval.id}`],
            },
          ).token
        : null;

    const workItem = approval.workItemId
      ? work.items.findById(approval.workItemId)
      : null;

    eventBus.emit({
      type: "run.awaiting_approval",
      runId: approval.runId,
      at: new Date().toISOString(),
      data: {
        approvalId: approval.id,
        subjectId: approval.subjectId,
        approveUrl:
          approvalToken && apiBaseUrl
            ? `${apiBaseUrl.replace(/\/+$/, "")}/api/v1/approvals/${approval.id}/approve-link?token=${encodeURIComponent(approvalToken)}`
            : null,
        prUrl: workItem?.webUrl ?? null,
        reviewerVerdict: approval.reviewVerdict,
        checksState: approval.checksState,
      },
    });
  };
}
