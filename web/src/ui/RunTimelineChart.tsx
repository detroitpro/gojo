import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { RotateCcw } from "lucide-react";

import { AppButton } from "@/ui/AppButton";
import { fmtDuration, fmtTime } from "@/kernel/format";
import { buildActivityItems, type ActivityItem } from "@/kernel/run-activity";
import { buildPhaseSegments, type PhaseKey } from "@/kernel/run-phases";
import { subscribeColorMode } from "@/platform/color-mode";
import type { RunEvent } from "@/contexts/execution/types";

const PHASE_Y: Record<PhaseKey, number> = {
  prepare: 3,
  agent: 2,
  validate: 1,
  integrate: 0,
};

const PHASE_COLORS: Record<PhaseKey, string> = {
  prepare: "rgba(140, 140, 150, 0.55)",
  agent: "rgba(80, 140, 220, 0.55)",
  validate: "rgba(70, 160, 120, 0.55)",
  integrate: "rgba(180, 130, 60, 0.55)",
};

const PHASE_LEGEND: Array<{ key: PhaseKey; label: string; color: string }> = [
  { key: "prepare", label: "Prepare", color: PHASE_COLORS.prepare },
  { key: "agent", label: "Agent", color: PHASE_COLORS.agent },
  { key: "validate", label: "Validate", color: PHASE_COLORS.validate },
  { key: "integrate", label: "Integrate", color: PHASE_COLORS.integrate },
];

const STATUS_FALLBACK: Record<"info" | "success" | "error" | "warn", string> = {
  info: "#8a9bb0",
  success: "#6fbf8f",
  error: "#e07070",
  warn: "#d0a55a",
};

interface PhaseBand {
  key: PhaseKey;
  x0: number;
  x1: number;
  y: number;
  label: string;
  durationMs: number;
}

interface TooltipState {
  show: boolean;
  x: number;
  y: number;
  title: string;
  detail: string;
}

export type RunTimelineChartProps = {
  events: RunEvent[];
  selectedPhase?: PhaseKey | null;
  onSelectPhase?: (phase: PhaseKey | null) => void;
  onSelectActivity?: (id: string | null) => void;
};

function themeColor(el: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

function statusFill(
  status: ActivityItem["status"],
  rootEl: HTMLElement,
  accent: string,
  textMuted: string,
): string {
  switch (status) {
    case "success":
      return themeColor(rootEl, "--green", STATUS_FALLBACK.success);
    case "error":
      return themeColor(rootEl, "--red", STATUS_FALLBACK.error);
    case "warn":
      return themeColor(rootEl, "--amber", STATUS_FALLBACK.warn);
    case "info":
    default:
      return accent || textMuted || themeColor(rootEl, "--blue", STATUS_FALLBACK.info);
  }
}

export function RunTimelineChart({
  events,
  selectedPhase = null,
  onSelectPhase,
  onSelectActivity,
}: RunTimelineChartProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    show: false,
    x: 0,
    y: 0,
    title: "",
    detail: "",
  });

  const activities = useMemo(() => buildActivityItems(events), [events]);
  const phases = useMemo(() => buildPhaseSegments(events), [events]);

  const range = useMemo(() => {
    const times = [
      ...phases.flatMap((p) => {
        const start = Date.parse(p.startedAt);
        const end = p.active
          ? Date.now()
          : p.finishedAt
            ? Date.parse(p.finishedAt)
            : start + p.durationMs;
        return [start, end];
      }),
      ...activities.map((a) => a.atMs),
    ].filter((n) => Number.isFinite(n) && n > 0);
    if (times.length === 0) {
      const now = Date.now();
      return { min: now - 60_000, max: now };
    }
    const min = Math.min(...times);
    const max = Math.max(...times);
    const pad = Math.max(1_000, (max - min) * 0.05);
    return { min: min - pad, max: max + pad };
  }, [phases, activities]);

  useEffect(() => {
    const chartEl = chartRef.current;
    const rootEl = rootRef.current;
    if (!chartEl || !rootEl) return;

    function destroy() {
      if (plotRef.current) {
        const over = plotRef.current.over as HTMLElement & { __gojoCleanup?: () => void };
        over.__gojoCleanup?.();
        plotRef.current.destroy();
        plotRef.current = null;
      }
    }

    function rebuild() {
      if (!chartEl || !rootEl) return;
      destroy();
      setTooltip((t) => ({ ...t, show: false }));

      const width = chartEl.clientWidth || 640;
      const height = 180;
      const textMuted = themeColor(rootEl, "--text-muted", "#44546f");
      const border = themeColor(rootEl, "--border", "#091e4224");
      const accent = themeColor(rootEl, "--accent", "#0c66e4");
      const bgElevated = themeColor(rootEl, "--bg-elevated", "#ffffff");

      const xs: number[] = [];
      const ys: number[] = [];
      const meta: ActivityItem[] = [];
      const fills: string[] = [];

      for (const item of activities) {
        if (!item.atMs) continue;
        const lane = item.phase ? PHASE_Y[item.phase] : 3.5;
        xs.push(item.atMs / 1000);
        ys.push(lane);
        meta.push(item);
        fills.push(statusFill(item.status, rootEl, accent, textMuted));
      }

      const hasPoints = xs.length > 0;
      if (!hasPoints) {
        xs.push(range.min / 1000, range.max / 1000);
        ys.push(-1, -1);
      }

      const phaseBands: PhaseBand[] = phases.map((segment) => {
        const startMs = Date.parse(segment.startedAt);
        const endMs = segment.active
          ? Date.now()
          : segment.finishedAt
            ? Date.parse(segment.finishedAt)
            : startMs + segment.durationMs;
        return {
          key: segment.key,
          x0: startMs / 1000,
          x1: endMs / 1000,
          y: PHASE_Y[segment.key],
          label: segment.label,
          durationMs: segment.durationMs,
        };
      });

      const opts: uPlot.Options = {
        width,
        height,
        scales: {
          x: { time: true, min: range.min / 1000, max: range.max / 1000 },
          y: { min: -0.5, max: 4 },
        },
        axes: [
          {
            stroke: textMuted,
            grid: { stroke: border, width: 1 },
            ticks: { stroke: border },
          },
          {
            show: true,
            stroke: textMuted,
            values: (_u, splits) =>
              splits.map((v) => {
                if (v === 3) return "Prepare";
                if (v === 2) return "Agent";
                if (v === 1) return "Validate";
                if (v === 0) return "Integrate";
                return "";
              }),
            grid: { show: false },
            ticks: { show: false },
            size: 72,
          },
        ],
        series: [
          {},
          { label: "activity", stroke: "transparent", points: { show: false }, paths: () => null },
        ],
        cursor: { drag: { x: true, y: false }, focus: { prox: 24 }, points: { show: false } },
        hooks: {
          draw: [
            (u) => {
              const ctx = u.ctx;
              for (const band of phaseBands) {
                const x0 = u.valToPos(band.x0, "x", true);
                const x1 = u.valToPos(band.x1, "x", true);
                const y = u.valToPos(band.y, "y", true);
                const h = Math.max(10, (u.valToPos(band.y - 0.35, "y", true) - y) * -1);
                ctx.save();
                ctx.fillStyle = PHASE_COLORS[band.key];
                ctx.fillRect(x0, y - h / 2, Math.max(2, x1 - x0), h);
                if (selectedPhase === band.key) {
                  ctx.strokeStyle = accent;
                  ctx.lineWidth = 2;
                  ctx.strokeRect(x0, y - h / 2, Math.max(2, x1 - x0), h);
                }
                ctx.restore();
              }
              if (!hasPoints) return;
              for (let i = 0; i < meta.length; i += 1) {
                const x = u.valToPos(xs[i]!, "x", true);
                const y = u.valToPos(ys[i]!, "y", true);
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fillStyle = fills[i] ?? accent;
                ctx.fill();
                ctx.strokeStyle = bgElevated;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
              }
            },
          ],
        },
      };

      const plot = new uPlot(opts, [xs, ys], chartEl);
      plotRef.current = plot;

      const over = plot.over;
      over.style.cursor = "crosshair";

      function nearestActivity(xVal: number, yVal: number) {
        let best: ActivityItem | null = null;
        let bestDist = Infinity;
        for (const item of meta) {
          const dx = Math.abs(item.atMs / 1000 - xVal);
          const lane = item.phase ? PHASE_Y[item.phase] : 3.5;
          const dy = Math.abs(lane - yVal);
          const dist = dx * 2 + dy;
          if (dist < bestDist) {
            bestDist = dist;
            best = item;
          }
        }
        return best ? { item: best, dist: bestDist } : null;
      }

      function bandUnder(xVal: number, yVal: number): PhaseBand | null {
        for (const band of phaseBands) {
          if (xVal >= band.x0 && xVal <= band.x1 && Math.abs(yVal - band.y) < 0.45) return band;
        }
        return null;
      }

      const onClick = (e: MouseEvent) => {
        const rect = over.getBoundingClientRect();
        const left = e.clientX - rect.left;
        const top = e.clientY - rect.top;
        const xVal = plot.posToVal(left, "x");
        const yVal = plot.posToVal(top, "y");
        const nearest = nearestActivity(xVal, yVal);
        if (nearest && nearest.dist < 2) {
          onSelectActivity?.(nearest.item.id);
          if (nearest.item.phase) onSelectPhase?.(nearest.item.phase);
          return;
        }
        const band = bandUnder(xVal, yVal);
        if (band) onSelectPhase?.(selectedPhase === band.key ? null : band.key);
      };

      const onMove = (e: MouseEvent) => {
        if (!rootEl) return;
        const overRect = over.getBoundingClientRect();
        const rootRect = rootEl.getBoundingClientRect();
        const left = e.clientX - overRect.left;
        const top = e.clientY - overRect.top;
        const xVal = plot.posToVal(left, "x");
        const yVal = plot.posToVal(top, "y");
        const nearest = nearestActivity(xVal, yVal);
        if (nearest && nearest.dist < 1.2) {
          const item = nearest.item;
          setTooltip({
            show: true,
            x: e.clientX - rootRect.left + 12,
            y: e.clientY - rootRect.top + 12,
            title: item.title,
            detail: `${item.kind}${item.status ? ` · ${item.status}` : ""} · ${fmtTime(item.at)}`,
          });
          return;
        }
        const band = bandUnder(xVal, yVal);
        if (band) {
          setTooltip({
            show: true,
            x: e.clientX - rootRect.left + 12,
            y: e.clientY - rootRect.top + 12,
            title: band.label,
            detail: `Phase · ${fmtDuration(band.durationMs)}`,
          });
          return;
        }
        setTooltip((t) => ({ ...t, show: false }));
      };

      const onLeave = () => setTooltip((t) => ({ ...t, show: false }));

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const scale = plot.scales.x;
        if (scale.min == null || scale.max == null) return;
        const rect = over.getBoundingClientRect();
        const left = e.clientX - rect.left;
        const cursorX = plot.posToVal(left, "x");
        const factor = e.deltaY > 0 ? 1.2 : 0.8;
        const span = scale.max - scale.min;
        const newSpan = Math.max(1, span * factor);
        const ratio = (cursorX - scale.min) / span;
        plot.setScale("x", {
          min: cursorX - newSpan * ratio,
          max: cursorX + newSpan * (1 - ratio),
        });
      };

      over.addEventListener("click", onClick);
      over.addEventListener("mousemove", onMove);
      over.addEventListener("mouseleave", onLeave);
      over.addEventListener("wheel", onWheel, { passive: false });

      (over as HTMLElement & { __gojoCleanup?: () => void }).__gojoCleanup = () => {
        over.removeEventListener("click", onClick);
        over.removeEventListener("mousemove", onMove);
        over.removeEventListener("mouseleave", onLeave);
        over.removeEventListener("wheel", onWheel);
      };
    }

    rebuild();
    window.addEventListener("resize", rebuild);
    const unsubscribeColor = subscribeColorMode(rebuild);
    return () => {
      window.removeEventListener("resize", rebuild);
      unsubscribeColor();
      destroy();
    };
  }, [events, selectedPhase, phases, activities, range, onSelectPhase, onSelectActivity]);

  function resetZoom() {
    if (!plotRef.current) return;
    plotRef.current.setScale("x", { min: range.min / 1000, max: range.max / 1000 });
  }

  const empty = phases.length === 0 && activities.length === 0;

  return (
    <div ref={rootRef} className="timeline-chart">
      <div className="timeline-chart-toolbar">
        <span className="muted">
          Bars = phase duration · Dots = activity events (click to jump) · Drag to pan · scroll to zoom
        </span>
        <AppButton size="sm" onClick={resetZoom} iconBefore={<RotateCcw size={12} />}>
          Reset zoom
        </AppButton>
      </div>

      <div className="timeline-legend" aria-label="Timeline legend">
        {PHASE_LEGEND.map((item) => (
          <span key={item.key} className="timeline-legend-item">
            <span className="timeline-legend-swatch" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
        <span className="timeline-legend-item">
          <span className="timeline-legend-dot" />
          Activity event
        </span>
      </div>

      <div ref={chartRef} className="timeline-chart-canvas" />

      {tooltip.show ? (
        <div
          className="timeline-tooltip"
          style={{ position: "absolute", left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
          role="tooltip"
        >
          <div className="timeline-tooltip-title">{tooltip.title}</div>
          <div className="timeline-tooltip-detail muted">{tooltip.detail}</div>
        </div>
      ) : null}

      {empty ? (
        <div className="muted timeline-chart-empty">Timeline populates as the run progresses.</div>
      ) : null}
    </div>
  );
}
