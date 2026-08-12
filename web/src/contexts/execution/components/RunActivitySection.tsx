import type { PhaseKey } from "@/kernel/run-phases";
import type { RunEvent } from "@/contexts/execution/types";
import { AppButton } from "@/ui/AppButton";
import { RunActivityFeed } from "@/ui/RunActivityFeed";
import { RunTimelineChart } from "@/ui/RunTimelineChart";

export type RunActivitySectionProps = {
  events: RunEvent[];
  selectedPhase: PhaseKey | null;
  highlightActivityId: string | null;
  onSelectedPhaseChange: (value: PhaseKey | null) => void;
  onHighlightActivityIdChange: (value: string | null) => void;
};

export function RunActivitySection({
  events,
  selectedPhase,
  highlightActivityId,
  onSelectedPhaseChange,
  onHighlightActivityIdChange,
}: RunActivitySectionProps) {
  return (
    <>
      <section className="panel">
        <div className="panel-header">Timeline</div>
        <div className="panel-body">
          <RunTimelineChart
            events={events}
            selectedPhase={selectedPhase}
            onSelectPhase={onSelectedPhaseChange}
            onSelectActivity={onHighlightActivityIdChange}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          Activity
          {selectedPhase ? (
            <AppButton size="sm" onClick={() => onSelectedPhaseChange(null)}>
              Clear phase filter
            </AppButton>
          ) : null}
        </div>
        <div className="panel-body">
          <RunActivityFeed
            events={events}
            phaseFilter={selectedPhase}
            highlightId={highlightActivityId}
          />
        </div>
      </section>
    </>
  );
}
