<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import AppButton from "@/ui/AppButton.vue";
import { RotateCcw } from "lucide-vue-next";
import { fmtDuration, fmtTime } from "@/kernel/format";
import { buildActivityItems, type ActivityItem } from "@/kernel/run-activity";
import { buildPhaseSegments, type PhaseKey } from "@/kernel/run-phases";
import type { RunEvent } from "@/contexts/execution/types";

const props = defineProps<{
  events: RunEvent[];
  selectedPhase?: PhaseKey | null;
}>();

const emit = defineEmits<{
  selectPhase: [phase: PhaseKey | null];
  selectActivity: [id: string | null];
}>();

const root = ref<HTMLElement | null>(null);
const chartEl = ref<HTMLElement | null>(null);
let plot: uPlot | null = null;

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

const tooltip = ref<TooltipState>({
  show: false,
  x: 0,
  y: 0,
  title: "",
  detail: "",
});

const activities = computed(() => buildActivityItems(props.events));
const phases = computed(() => buildPhaseSegments(props.events));

const range = computed(() => {
  const times = [
    ...phases.value.flatMap((p) => {
      const start = Date.parse(p.startedAt);
      const end = p.active
        ? Date.now()
        : p.finishedAt
          ? Date.parse(p.finishedAt)
          : start + p.durationMs;
      return [start, end];
    }),
    ...activities.value.map((a) => a.atMs),
  ].filter((n) => Number.isFinite(n) && n > 0);

  if (times.length === 0) {
    const now = Date.now();
    return { min: now - 60_000, max: now };
  }
  const min = Math.min(...times);
  const max = Math.max(...times);
  const pad = Math.max(1_000, (max - min) * 0.05);
  return { min: min - pad, max: max + pad };
});

function destroy() {
  if (plot) {
    const over = plot.over as HTMLElement & { __gojoCleanup?: () => void };
    over.__gojoCleanup?.();
    plot.destroy();
  }
  plot = null;
}

/** Canvas cannot resolve CSS variables — read computed theme tokens. */
function themeColor(name: string, fallback: string): string {
  const el = root.value ?? document.documentElement;
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

function statusFill(
  status: ActivityItem["status"],
  accent: string,
  textMuted: string,
): string {
  switch (status) {
    case "success":
      return STATUS_FALLBACK.success;
    case "error":
      return STATUS_FALLBACK.error;
    case "warn":
      return STATUS_FALLBACK.warn;
    case "info":
    default:
      return accent || textMuted || STATUS_FALLBACK.info;
  }
}

function nearestActivity(
  meta: ActivityItem[],
  xVal: number,
  yVal: number,
): { item: ActivityItem; dist: number } | null {
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

function bandUnder(
  bands: PhaseBand[],
  xVal: number,
  yVal: number,
): PhaseBand | null {
  for (const band of bands) {
    if (xVal >= band.x0 && xVal <= band.x1 && Math.abs(yVal - band.y) < 0.45) {
      return band;
    }
  }
  return null;
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
  const height = 180;
  const textMuted = themeColor("--text-muted", "#9a9a9a");
  const border = themeColor("--border", "#333");
  const accent = themeColor("--accent", "#6a9fd8");
  const bgElevated = themeColor("--bg-elevated", "#1e1e22");

  // Sparse marker series: x = time, y = lane (hit-testing only; dots drawn in hook).
  const xs: number[] = [];
  const ys: number[] = [];
  const meta: ActivityItem[] = [];
  const fills: string[] = [];

  for (const item of activities.value) {
    if (!item.atMs) {
      continue;
    }
    const lane = item.phase ? PHASE_Y[item.phase] : 3.5;
    xs.push(item.atMs / 1000);
    ys.push(lane);
    meta.push(item);
    fills.push(statusFill(item.status, accent, textMuted));
  }

  const hasPoints = xs.length > 0;
  if (!hasPoints) {
    xs.push(range.value.min / 1000, range.value.max / 1000);
    ys.push(-1, -1);
  }

  const phaseBands: PhaseBand[] = phases.value.map((segment) => {
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
      x: {
        time: true,
        min: range.value.min / 1000,
        max: range.value.max / 1000,
      },
      y: {
        min: -0.5,
        max: 4,
      },
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
      {
        label: "activity",
        stroke: "transparent",
        points: {
          show: false,
        },
        paths: () => null,
      },
    ],
    cursor: {
      drag: { x: true, y: false },
      focus: { prox: 24 },
      points: { show: false },
    },
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
            if (props.selectedPhase === band.key) {
              ctx.strokeStyle = accent;
              ctx.lineWidth = 2;
              ctx.strokeRect(x0, y - h / 2, Math.max(2, x1 - x0), h);
            }
            ctx.restore();
          }

          if (!hasPoints) {
            return;
          }
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

  plot = new uPlot(opts, [xs, ys], chartEl.value);

  const over = plot.over;
  over.style.cursor = "crosshair";

  const onClick = (e: MouseEvent) => {
    if (!plot) {
      return;
    }
    const rect = over.getBoundingClientRect();
    const left = e.clientX - rect.left;
    const top = e.clientY - rect.top;
    const xVal = plot.posToVal(left, "x");
    const yVal = plot.posToVal(top, "y");

    const nearest = nearestActivity(meta, xVal, yVal);
    if (nearest && nearest.dist < 2) {
      emit("selectActivity", nearest.item.id);
      if (nearest.item.phase) {
        emit("selectPhase", nearest.item.phase);
      }
      return;
    }

    const band = bandUnder(phaseBands, xVal, yVal);
    if (band) {
      emit("selectPhase", props.selectedPhase === band.key ? null : band.key);
    }
  };

  const onMove = (e: MouseEvent) => {
    if (!plot || !root.value) {
      return;
    }
    const overRect = over.getBoundingClientRect();
    const rootRect = root.value.getBoundingClientRect();
    const left = e.clientX - overRect.left;
    const top = e.clientY - overRect.top;
    const xVal = plot.posToVal(left, "x");
    const yVal = plot.posToVal(top, "y");

    const nearest = nearestActivity(meta, xVal, yVal);
    if (nearest && nearest.dist < 1.2) {
      const item = nearest.item;
      tooltip.value = {
        show: true,
        x: e.clientX - rootRect.left + 12,
        y: e.clientY - rootRect.top + 12,
        title: item.title,
        detail: `${item.kind}${item.status ? ` · ${item.status}` : ""} · ${fmtTime(item.at)}`,
      };
      return;
    }

    const band = bandUnder(phaseBands, xVal, yVal);
    if (band) {
      tooltip.value = {
        show: true,
        x: e.clientX - rootRect.left + 12,
        y: e.clientY - rootRect.top + 12,
        title: band.label,
        detail: `Phase · ${fmtDuration(band.durationMs)}`,
      };
      return;
    }

    hideTooltip();
  };

  const onLeave = () => {
    hideTooltip();
  };

  over.addEventListener("click", onClick);
  over.addEventListener("mousemove", onMove);
  over.addEventListener("mouseleave", onLeave);

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
    const newSpan = Math.max(1, span * factor);
    const ratio = (cursorX - scale.min) / span;
    plot.setScale("x", {
      min: cursorX - newSpan * ratio,
      max: cursorX + newSpan * (1 - ratio),
    });
  };
  over.addEventListener("wheel", onWheel, { passive: false });

  (over as HTMLElement & { __gojoCleanup?: () => void }).__gojoCleanup = () => {
    over.removeEventListener("click", onClick);
    over.removeEventListener("mousemove", onMove);
    over.removeEventListener("mouseleave", onLeave);
    over.removeEventListener("wheel", onWheel);
  };
}

function resetZoom() {
  if (!plot) {
    return;
  }
  plot.setScale("x", {
    min: range.value.min / 1000,
    max: range.value.max / 1000,
  });
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
  () => [props.events, props.selectedPhase] as const,
  () => rebuild(),
  { deep: true },
);
</script>

<template>
  <div ref="root" class="timeline-chart">
    <div class="timeline-chart-toolbar">
      <span class="muted"
        >Bars = phase duration · Dots = activity events (click to jump) · Drag to pan ·
        scroll to zoom</span
      >
      <AppButton size="sm" :icon="RotateCcw" @click="resetZoom">Reset zoom</AppButton>
    </div>

    <div class="timeline-legend" aria-label="Timeline legend">
      <span
        v-for="item in PHASE_LEGEND"
        :key="item.key"
        class="timeline-legend-item"
      >
        <span class="timeline-legend-swatch" :style="{ background: item.color }" />
        {{ item.label }}
      </span>
      <span class="timeline-legend-item">
        <span class="timeline-legend-dot" />
        Activity event
      </span>
    </div>

    <div ref="chartEl" class="timeline-chart-canvas" />

    <div
      v-if="tooltip.show"
      class="timeline-tooltip"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      role="tooltip"
    >
      <div class="timeline-tooltip-title">{{ tooltip.title }}</div>
      <div class="timeline-tooltip-detail muted">{{ tooltip.detail }}</div>
    </div>

    <div v-if="phases.length === 0 && activities.length === 0" class="muted timeline-chart-empty">
      Timeline populates as the run progresses.
    </div>
  </div>
</template>
