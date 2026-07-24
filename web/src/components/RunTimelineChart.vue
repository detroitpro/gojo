<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { buildActivityItems, type ActivityItem } from "@/lib/run-activity";
import { buildPhaseSegments, type PhaseKey } from "@/lib/run-phases";
import type { RunEvent } from "@/types";

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

const activities = computed(() => buildActivityItems(props.events));
const phases = computed(() => buildPhaseSegments(props.events));

const range = computed(() => {
  const times = [
    ...phases.value.flatMap((p) => [Date.parse(p.startedAt), p.finishedAt ? Date.parse(p.finishedAt) : Date.now()]),
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
  plot?.destroy();
  plot = null;
}

function rebuild() {
  if (!chartEl.value) {
    return;
  }
  destroy();

  const width = chartEl.value.clientWidth || 640;
  const height = 180;

  // Sparse marker series: x = time, y = lane
  const xs: number[] = [];
  const ys: number[] = [];
  const meta: ActivityItem[] = [];

  for (const item of activities.value) {
    if (!item.atMs) {
      continue;
    }
    const lane = item.phase ? PHASE_Y[item.phase] : 3.5;
    xs.push(item.atMs / 1000);
    ys.push(lane);
    meta.push(item);
  }

  if (xs.length === 0) {
    // Placeholder points so uPlot renders scales; kept off-lane.
    xs.push(range.value.min / 1000, range.value.max / 1000);
    ys.push(-1, -1);
  }

  const phaseBands = phases.value.map((segment) => ({
    key: segment.key,
    x0: Date.parse(segment.startedAt) / 1000,
    x1: (segment.finishedAt ? Date.parse(segment.finishedAt) : Date.now()) / 1000,
    y: PHASE_Y[segment.key],
    label: segment.label,
  }));

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
        stroke: "var(--text-muted)",
        grid: { stroke: "var(--border)", width: 1 },
        ticks: { stroke: "var(--border)" },
      },
      {
        show: true,
        stroke: "var(--text-muted)",
        values: (_u, splits) =>
          splits.map((v) => {
            if (v === 3) return "Prep";
            if (v === 2) return "Agent";
            if (v === 1) return "Valid";
            if (v === 0) return "Integ";
            return "";
          }),
        grid: { show: false },
        ticks: { show: false },
        size: 48,
      },
    ],
    series: [
      {},
      {
        label: "activity",
        stroke: "var(--accent)",
        points: {
          show: true,
          size: 8,
          fill: "var(--accent)",
        },
        paths: () => null,
      },
    ],
    cursor: {
      drag: { x: true, y: false },
      focus: { prox: 24 },
    },
    hooks: {
      draw: [
        (u) => {
          const ctx = u.ctx;
          const yMin = u.bbox.top;
          const yMax = u.bbox.top + u.bbox.height;
          void yMin;
          void yMax;
          for (const band of phaseBands) {
            const x0 = u.valToPos(band.x0, "x", true);
            const x1 = u.valToPos(band.x1, "x", true);
            const y = u.valToPos(band.y, "y", true);
            const h = Math.max(10, (u.valToPos(band.y - 0.35, "y", true) - y) * -1);
            ctx.save();
            ctx.fillStyle = PHASE_COLORS[band.key];
            ctx.fillRect(x0, y - h / 2, Math.max(2, x1 - x0), h);
            if (props.selectedPhase === band.key) {
              ctx.strokeStyle = "var(--accent)";
              ctx.lineWidth = 2;
              ctx.strokeRect(x0, y - h / 2, Math.max(2, x1 - x0), h);
            }
            ctx.restore();
          }
        },
      ],
      setCursor: [
        (u) => {
          const idx = u.cursor.idx;
          if (idx == null || !meta[idx]) {
            return;
          }
        },
      ],
    },
  };

  // Attach click via over element after create
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

    // Prefer activity nearest in time within proximity
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
    if (best && bestDist < 2) {
      emit("selectActivity", best.id);
      if (best.phase) {
        emit("selectPhase", best.phase);
      }
      return;
    }

    // Otherwise select phase band under cursor
    for (const band of phaseBands) {
      if (xVal >= band.x0 && xVal <= band.x1 && Math.abs(yVal - band.y) < 0.45) {
        emit("selectPhase", props.selectedPhase === band.key ? null : band.key);
        return;
      }
    }
  };

  over.addEventListener("click", onClick);

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

  // stash cleanup on element
  (over as HTMLElement & { __gojoCleanup?: () => void }).__gojoCleanup = () => {
    over.removeEventListener("click", onClick);
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
  if (plot) {
    const over = plot.over as HTMLElement & { __gojoCleanup?: () => void };
    over.__gojoCleanup?.();
  }
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
      <span class="muted">Drag to pan · scroll to zoom · click phase/activity</span>
      <button class="btn btn-sm" type="button" @click="resetZoom">Reset zoom</button>
    </div>
    <div ref="chartEl" class="timeline-chart-canvas" />
    <div v-if="phases.length === 0 && activities.length === 0" class="muted timeline-chart-empty">
      Timeline populates as the run progresses.
    </div>
  </div>
</template>
