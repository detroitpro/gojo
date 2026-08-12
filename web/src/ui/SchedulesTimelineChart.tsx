import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { formatAbsoluteInZone, formatRelativeNextRun } from "@/kernel/schedule-format";
import { subscribeColorMode } from "@/platform/color-mode";
import type { UpcomingScheduleSeries } from "@/contexts/scheduling/types";

interface TooltipState {
  show: boolean;
  x: number;
  y: number;
  title: string;
  detail: string;
}

function themeColor(el: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

export type SchedulesTimelineChartProps = {
  schedules: UpcomingScheduleSeries[];
  from: string;
  to: string;
};

export function SchedulesTimelineChart({ schedules, from, to }: SchedulesTimelineChartProps) {
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
      const laneCount = Math.max(schedules.length, 1);
      const height = Math.min(320, Math.max(140, 48 + laneCount * 22));
      const textMuted = themeColor(rootEl, "--text-muted", "#44546f");
      const border = themeColor(rootEl, "--border", "#091e4224");
      const bgElevated = themeColor(rootEl, "--bg-elevated", "#ffffff");

      const fromMs = Date.parse(from);
      const toMs = Date.parse(to);
      const minX = (Number.isFinite(fromMs) ? fromMs : Date.now()) / 1000;
      const maxX = (Number.isFinite(toMs) ? toMs : Date.now() + 86400_000) / 1000;

      const xs: number[] = [];
      const ys: number[] = [];
      const meta: Array<{ schedule: UpcomingScheduleSeries; at: string }> = [];

      schedules.forEach((schedule, lane) => {
        const y = laneCount - 1 - lane;
        for (const fire of schedule.fires) {
          const ms = Date.parse(fire);
          if (!Number.isFinite(ms)) continue;
          xs.push(ms / 1000);
          ys.push(y);
          meta.push({ schedule, at: fire });
        }
      });

      if (xs.length === 0) {
        xs.push(minX, maxX);
        ys.push(-1, -1);
      }

      const labelValues = (_u: uPlot, splits: number[]) =>
        splits.map((v) => {
          const idx = Math.round(v);
          const schedule = schedules[laneCount - 1 - idx];
          if (!schedule) return "";
          const name = schedule.name;
          return name.length > 14 ? `${name.slice(0, 13)}…` : name;
        });

      const opts: uPlot.Options = {
        width,
        height,
        scales: {
          x: { time: true, min: minX, max: maxX },
          y: { min: -0.5, max: laneCount - 0.5 },
        },
        axes: [
          {
            stroke: textMuted,
            grid: { stroke: border, width: 1 },
            ticks: { stroke: border },
          },
          {
            stroke: textMuted,
            values: labelValues,
            grid: { show: false },
            ticks: { show: false },
            size: 96,
          },
        ],
        series: [
          {},
          { label: "fires", stroke: "transparent", points: { show: false }, paths: () => null },
        ],
        cursor: { drag: { x: true, y: false }, points: { show: false } },
        hooks: {
          draw: [
            (u) => {
              const ctx = u.ctx;
              for (let i = 0; i < meta.length; i += 1) {
                const item = meta[i]!;
                const x = u.valToPos(xs[i]!, "x", true);
                const y = u.valToPos(ys[i]!, "y", true);
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, item.schedule.enabled ? 4.5 : 3.5, 0, Math.PI * 2);
                ctx.fillStyle = item.schedule.color;
                ctx.globalAlpha = item.schedule.enabled ? 1 : 0.45;
                ctx.fill();
                ctx.strokeStyle = bgElevated;
                ctx.lineWidth = 1;
                ctx.globalAlpha = 1;
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

      const onMove = (e: MouseEvent) => {
        if (!rootEl || meta.length === 0) return;
        const overRect = over.getBoundingClientRect();
        const rootRect = rootEl.getBoundingClientRect();
        const left = e.clientX - overRect.left;
        const top = e.clientY - overRect.top;
        const xVal = plot.posToVal(left, "x");
        const yVal = plot.posToVal(top, "y");

        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < meta.length; i += 1) {
          const dx = Math.abs(xs[i]! - xVal);
          const dy = Math.abs(ys[i]! - yVal);
          const dist = dx * 2 + dy;
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }

        if (bestIdx >= 0) {
          const px = plot.valToPos(xs[bestIdx]!, "x", false);
          const py = plot.valToPos(ys[bestIdx]!, "y", false);
          const pixDist = Math.hypot(left - px, top - py);
          if (pixDist < 18) {
            const item = meta[bestIdx]!;
            setTooltip({
              show: true,
              x: e.clientX - rootRect.left + 12,
              y: e.clientY - rootRect.top + 12,
              title: item.schedule.name,
              detail: `${formatRelativeNextRun(item.at, Date.now(), item.schedule.timezone)} · ${formatAbsoluteInZone(item.at, item.schedule.timezone)}`,
            });
            return;
          }
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
        const newSpan = Math.max(60, span * factor);
        const ratio = (cursorX - scale.min) / span;
        plot.setScale("x", {
          min: cursorX - newSpan * ratio,
          max: cursorX + newSpan * (1 - ratio),
        });
      };

      over.addEventListener("mousemove", onMove);
      over.addEventListener("mouseleave", onLeave);
      over.addEventListener("wheel", onWheel, { passive: false });

      (over as HTMLElement & { __gojoCleanup?: () => void }).__gojoCleanup = () => {
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
  }, [schedules, from, to]);

  const emptyNoSchedules = schedules.length === 0;
  const emptyNoFires = !emptyNoSchedules && schedules.every((s) => s.fires.length === 0);

  return (
    <div ref={rootRef} className="schedules-timeline" style={{ position: "relative" }}>
      <div ref={chartRef} className="schedules-timeline-canvas" />
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
      {emptyNoSchedules ? (
        <div className="muted schedules-timeline-empty">No schedules match these filters.</div>
      ) : null}
      {emptyNoFires ? (
        <div className="muted schedules-timeline-empty">No fires in this horizon.</div>
      ) : null}
      {schedules.length ? (
        <ul className="schedules-timeline-legend">
          {schedules.map((schedule) => (
            <li key={schedule.id}>
              <span
                className="schedules-legend-swatch"
                style={{ background: schedule.color }}
              />
              <span className={schedule.enabled ? "" : "muted"}>{schedule.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
