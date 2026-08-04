<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { formatAbsoluteInZone, formatRelativeNextRun } from "@/kernel/schedule-format";
import type { UpcomingScheduleSeries } from "@/contexts/scheduling/types";

const props = defineProps<{
  schedules: UpcomingScheduleSeries[];
  from: string;
  to: string;
}>();

const root = ref<HTMLElement | null>(null);
const chartEl = ref<HTMLElement | null>(null);
let plot: uPlot | null = null;

interface TooltipState {
  show: boolean;
  x: number;
  y: number;
  title: string;
  detail: string;
}

const tooltip = ref<TooltipState>({
  show: false,
  x: 0,
  y: 0,
  title: "",
  detail: "",
});

function themeColor(name: string, fallback: string): string {
  const el = root.value ?? document.documentElement;
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

function destroy() {
  if (plot) {
    const over = plot.over as HTMLElement & { __gojoCleanup?: () => void };
    over.__gojoCleanup?.();
    plot.destroy();
  }
  plot = null;
}

function hideTooltip() {
  tooltip.value = { ...tooltip.value, show: false };
}

function rebuild() {
  if (!chartEl.value) {
    return;
  }
  destroy();
  hideTooltip();

  const width = chartEl.value.clientWidth || 640;
  const laneCount = Math.max(props.schedules.length, 1);
  const height = Math.min(320, Math.max(140, 48 + laneCount * 22));
  const textMuted = themeColor("--text-muted", "#9a9a9a");
  const border = themeColor("--border", "#333");
  const bgElevated = themeColor("--bg-elevated", "#1e1e22");

  const fromMs = Date.parse(props.from);
  const toMs = Date.parse(props.to);
  const minX = (Number.isFinite(fromMs) ? fromMs : Date.now()) / 1000;
  const maxX = (Number.isFinite(toMs) ? toMs : Date.now() + 86400_000) / 1000;

  // Single series of points; colors drawn per-fire from meta.
  const xs: number[] = [];
  const ys: number[] = [];
  const meta: Array<{ schedule: UpcomingScheduleSeries; at: string }> = [];

  props.schedules.forEach((schedule, lane) => {
    const y = laneCount - 1 - lane;
    for (const fire of schedule.fires) {
      const ms = Date.parse(fire);
      if (!Number.isFinite(ms)) {
        continue;
      }
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
      const schedule = props.schedules[laneCount - 1 - idx];
      if (!schedule) {
        return "";
      }
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
      {
        label: "fires",
        stroke: "transparent",
        points: { show: false },
        paths: () => null,
      },
    ],
    cursor: {
      drag: { x: true, y: false },
      points: { show: false },
    },
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

  plot = new uPlot(opts, [xs, ys], chartEl.value);
  const over = plot.over;
  over.style.cursor = "crosshair";

  const onMove = (e: MouseEvent) => {
    if (!plot || !root.value || meta.length === 0) {
      return;
    }
    const overRect = over.getBoundingClientRect();
    const rootRect = root.value.getBoundingClientRect();
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

    // ~proximity in data units (hours scale varies) — use pixel distance instead
    if (bestIdx >= 0) {
      const px = plot.valToPos(xs[bestIdx]!, "x", false);
      const py = plot.valToPos(ys[bestIdx]!, "y", false);
      const pixDist = Math.hypot(left - px, top - py);
      if (pixDist < 18) {
        const item = meta[bestIdx]!;
        tooltip.value = {
          show: true,
          x: e.clientX - rootRect.left + 12,
          y: e.clientY - rootRect.top + 12,
          title: item.schedule.name,
          detail: `${formatRelativeNextRun(item.at, Date.now(), item.schedule.timezone)} · ${formatAbsoluteInZone(item.at, item.schedule.timezone)}`,
        };
        return;
      }
    }
    hideTooltip();
  };

  const onLeave = () => hideTooltip();

  const onWheel = (e: WheelEvent) => {
    if (!plot) {
      return;
    }
    e.preventDefault();
    const scale = plot.scales.x;
    if (scale.min == null || scale.max == null) {
      return;
    }
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

onMounted(() => {
  rebuild();
  window.addEventListener("resize", rebuild);
});

onUnmounted(() => {
  window.removeEventListener("resize", rebuild);
  destroy();
});

watch(
  () => [props.schedules, props.from, props.to] as const,
  () => rebuild(),
  { deep: true },
);
</script>

<template>
  <div ref="root" class="schedules-timeline">
    <div ref="chartEl" class="schedules-timeline-canvas" />
    <div
      v-if="tooltip.show"
      class="timeline-tooltip"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      role="tooltip"
    >
      <div class="timeline-tooltip-title">{{ tooltip.title }}</div>
      <div class="timeline-tooltip-detail muted">{{ tooltip.detail }}</div>
    </div>
    <div v-if="schedules.length === 0" class="muted schedules-timeline-empty">
      No schedules match these filters.
    </div>
    <div
      v-else-if="schedules.every((s) => s.fires.length === 0)"
      class="muted schedules-timeline-empty"
    >
      No fires in this horizon.
    </div>
    <ul v-if="schedules.length" class="schedules-timeline-legend">
      <li v-for="schedule in schedules" :key="schedule.id">
        <span class="schedules-legend-swatch" :style="{ background: schedule.color }" />
        <span :class="{ muted: !schedule.enabled }">{{ schedule.name }}</span>
      </li>
    </ul>
  </div>
</template>
