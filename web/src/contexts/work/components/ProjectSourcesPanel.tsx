import type { ProjectSource } from "@/contexts/work/types";
import { SyncStateBadge } from "@/ui/status/SyncStateBadge";

export function ProjectSourcesPanel({ sources }: { sources: ProjectSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="source-health mt-5">
      {sources.map((source) => (
        <span
          key={source.id}
          className="source-health__item"
          title={source.lastError ?? `Observed ${source.observedAt ?? "never"}`}
        >
          <span className="muted text-sm">{source.displayName}</span>
          <SyncStateBadge syncState={source.syncState} showLabel={false} />
        </span>
      ))}
    </div>
  );
}
