import { useMemo, useState, type MouseEvent, type FocusEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { fmtTime } from "@/kernel/format";
import { runStateBadgeClass } from "@/kernel/run-state-badge";
import type { DashboardOverviewRun } from "@/contexts/operations/types";

const SLOT_COUNT = 5;

const LIVE_STATES = new Set([
  "Preparing",
  "Running",
  "Validating",
  "AwaitingApproval",
  "Integrating",
  "Reporting",
]);

type Slot =
  | { kind: "empty"; key: string }
  | { kind: "run"; key: string; run: DashboardOverviewRun; live: boolean };

function relativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const deltaSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return rtf.format(deltaSec, "second");
  if (abs < 3600) return rtf.format(Math.round(deltaSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(deltaSec / 3600), "hour");
  return rtf.format(Math.round(deltaSec / 86400), "day");
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}

export function RunHistoryStrip({ runs }: { runs: DashboardOverviewRun[] }) {
  const slots = useMemo<Slot[]>(() => {
    const trimmed = runs.slice(-SLOT_COUNT);
    const emptyCount = SLOT_COUNT - trimmed.length;
    const empties: Slot[] = Array.from({ length: emptyCount }, (_, i) => ({
      kind: "empty" as const,
      key: `empty-${i}`,
    }));
    const filled: Slot[] = trimmed.map((run) => ({
      kind: "run" as const,
      key: run.id,
      run,
      live: LIVE_STATES.has(run.state),
    }));
    return [...empties, ...filled];
  }, [runs]);

  const hasLive = slots.some((slot) => slot.kind === "run" && slot.live);

  const [tip, setTip] = useState<{
    show: boolean;
    x: number;
    y: number;
    state: string;
    relative: string;
    absolute: string;
    trigger: string;
    id: string;
  }>({
    show: false,
    x: 0,
    y: 0,
    state: "",
    relative: "",
    absolute: "",
    trigger: "",
    id: "",
  });

  function showTip(
    event: MouseEvent<HTMLAnchorElement> | FocusEvent<HTMLAnchorElement>,
    run: DashboardOverviewRun,
  ) {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    setTip({
      show: true,
      x: rect.left + rect.width / 2,
      y: rect.top,
      state: run.state,
      relative: relativeTime(run.createdAt),
      absolute: fmtTime(run.createdAt),
      trigger: run.trigger,
      id: shortId(run.id),
    });
  }

  function hideTip() {
    setTip((prev) => ({ ...prev, show: false }));
  }

  return (
    <div
      className={`run-history-strip${hasLive ? " is-live" : ""}`}
      aria-label={hasLive ? "Last five runs — agent is running" : "Last five runs"}
    >
      {slots.map((slot) =>
        slot.kind === "empty" ? (
          <span key={slot.key} className="run-strip-cell run-strip-empty" title="No run" />
        ) : (
          <Link
            key={slot.key}
            to={`/runs/${slot.run.id}`}
            className={`run-strip-cell ${runStateBadgeClass(slot.run.state)}${slot.live ? " is-live" : ""}`}
            aria-label={`${slot.run.state} run ${shortId(slot.run.id)}${slot.live ? " (in progress)" : ""}`}
            onMouseEnter={(e) => showTip(e, slot.run)}
            onMouseLeave={hideTip}
            onFocus={(e) => showTip(e, slot.run)}
            onBlur={hideTip}
          />
        ),
      )}
      {tip.show
        ? createPortal(
            <div
              className="run-strip-floating-tip timeline-tooltip"
              style={{ position: "fixed", left: `${tip.x}px`, top: `${tip.y}px`, zIndex: 1000, transform: "translate(-50%, calc(-100% - 8px))", pointerEvents: "none" }}
              role="tooltip"
            >
              <div className="timeline-tooltip-title">{tip.state}</div>
              <div className="timeline-tooltip-detail muted">
                {tip.relative} · {tip.absolute}
              </div>
              <div className="timeline-tooltip-detail muted">
                {tip.trigger} · {tip.id}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
