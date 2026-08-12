import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";

import type {
  ChangeDayGroup,
  CompletedWorkPresentation,
} from "@/kernel/project-overview";
import { AppButton } from "@/ui/AppButton";
import { ChangeRow, type ChangeRowVariant } from "@/ui/ChangeRow";

export type ChangeFeedProps = {
  groups: ChangeDayGroup[];
  impactByRun?: Record<string, string[]>;
  loading?: boolean;
  error?: string | null;
  emptyMessage: string;
  emptyHint?: string | null;
  /** Compact overview feed vs detailed full-history feed. */
  variant?: ChangeRowVariant;
  loadingMessage?: string;
  /** Overview: link to full history. Pass null to hide (history page). */
  historyProjectId?: string | null;
  footer?: ReactNode;
  onRetry?: () => void;
};

function categoriesFor(
  item: CompletedWorkPresentation,
  impactByRun: Record<string, string[]>,
): string[] {
  if (!item.runId) return [];
  return impactByRun[item.runId] ?? [];
}

export function ChangeFeed({
  groups,
  impactByRun = {},
  loading,
  error,
  emptyMessage,
  emptyHint,
  variant = "compact",
  loadingMessage = "Loading recent changes…",
  historyProjectId = null,
  footer,
  onRetry,
}: ChangeFeedProps) {
  const colCount = variant === "detailed" ? 6 : 4;

  if (loading && groups.length === 0) {
    return <div className="muted text-sm">{loadingMessage}</div>;
  }
  if (error && groups.length === 0) {
    return (
      <div className="alert alert-error">
        <p>{error}</p>
        {onRetry ? (
          <AppButton className="mt-3" onClick={onRetry}>
            Retry
          </AppButton>
        ) : null}
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="change-feed__empty">
        <p>{emptyMessage}</p>
        {emptyHint ? <p className="muted text-sm mt-2">{emptyHint}</p> : null}
      </div>
    );
  }

  return (
    <div className={`change-feed change-feed--${variant}`}>
      <div className="table-wrap">
        <table className="data change-feed__table">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Change</th>
              {variant === "detailed" ? <th scope="col">Type</th> : null}
              <th scope="col">Tags</th>
              {variant === "detailed" ? <th scope="col">Source</th> : null}
              <th scope="col">{variant === "detailed" ? "When" : "Time"}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                <tr className="change-feed__day-row">
                  <th scope="colgroup" colSpan={colCount}>
                    {group.label}
                  </th>
                </tr>
                {group.items.map((item) => (
                  <ChangeRow
                    key={item.id}
                    item={item}
                    categories={categoriesFor(item, impactByRun)}
                    variant={variant}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {footer !== undefined ? (
        footer
      ) : historyProjectId ? (
        <div className="change-feed__footer">
          <Link className="text-sm" to={`/projects/${historyProjectId}/history`}>
            View all history
          </Link>
        </div>
      ) : null}
    </div>
  );
}
