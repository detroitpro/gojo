import { useState } from "react";
import { Copy } from "lucide-react";

import type {
  ActivitySummaryMetrics,
  ChangeDayGroup,
} from "@/kernel/project-overview";
import { formatFeedCountsLine } from "@/kernel/project-overview";
import { AppButton } from "@/ui/AppButton";
import { ChangeFeed } from "@/ui/ChangeFeed";

export type RecentActivitySectionProps = {
  metrics: ActivitySummaryMetrics;
  groups: ChangeDayGroup[];
  impactByRun: Record<string, string[]>;
  digestText: string;
  loading?: boolean;
  error?: string | null;
  emptyMessage: string;
  emptyHint?: string | null;
  projectId: string;
  onRetry?: () => void;
};

export function RecentActivitySection({
  metrics,
  groups,
  impactByRun,
  digestText,
  loading,
  error,
  emptyMessage,
  emptyHint,
  projectId,
  onRetry,
}: RecentActivitySectionProps) {
  const [copied, setCopied] = useState(false);

  async function copyDigest() {
    try {
      await navigator.clipboard.writeText(digestText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      className="recent-activity panel mb-7"
      aria-labelledby="recent-activity-heading"
    >
      <div className="panel-header recent-activity__header">
        <div className="recent-activity__heading">
          <h2 id="recent-activity-heading">Recent changes</h2>
          <span className="recent-activity__counts">{formatFeedCountsLine(metrics)}</span>
        </div>
        <AppButton
          size="sm"
          variant="ghost"
          ariaLabel={copied ? "Digest copied" : "Copy digest"}
          onClick={() => void copyDigest()}
          iconBefore={<Copy size={12} />}
        >
          {copied ? "Copied" : "Copy"}
        </AppButton>
      </div>
      <div className="panel-body">
        <ChangeFeed
          groups={groups}
          impactByRun={impactByRun}
          loading={loading}
          error={error}
          emptyMessage={emptyMessage}
          emptyHint={emptyHint}
          historyProjectId={projectId}
          onRetry={onRetry}
        />
      </div>
    </section>
  );
}
