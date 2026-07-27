<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";

import { fmtTime } from "@/lib/format";
import { runStateBadgeClass } from "@/lib/run-state-badge";
import type { DashboardOverviewRun } from "@/types";

const SLOT_COUNT = 5;

const LIVE_STATES = new Set([
  "Preparing",
  "Running",
  "Validating",
  "AwaitingApproval",
  "Integrating",
  "Reporting",
]);

const props = defineProps<{
  runs: DashboardOverviewRun[];
}>();

type Slot =
  | { kind: "empty"; key: string }
  | { kind: "run"; key: string; run: DashboardOverviewRun; live: boolean };

function isLive(state: string): boolean {
  return LIVE_STATES.has(state);
}

const slots = computed((): Slot[] => {
  const runs = props.runs.slice(-SLOT_COUNT);
  const emptyCount = SLOT_COUNT - runs.length;
  const empties: Slot[] = Array.from({ length: emptyCount }, (_, i) => ({
    kind: "empty" as const,
    key: `empty-${i}`,
  }));
  const filled: Slot[] = runs.map((run) => ({
    kind: "run" as const,
    key: run.id,
    run,
    live: isLive(run.state),
  }));
  return [...empties, ...filled];
});

const hasLive = computed(() => slots.value.some((slot) => slot.kind === "run" && slot.live));

const tip = ref<{
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

function relativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return "—";
  }
  const deltaSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) {
    return rtf.format(deltaSec, "second");
  }
  if (abs < 3600) {
    return rtf.format(Math.round(deltaSec / 60), "minute");
  }
  if (abs < 86400) {
    return rtf.format(Math.round(deltaSec / 3600), "hour");
  }
  return rtf.format(Math.round(deltaSec / 86400), "day");
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}…` : id;
}

function showTip(event: MouseEvent | FocusEvent, run: DashboardOverviewRun) {
  const el = event.currentTarget;
  if (!(el instanceof HTMLElement)) {
    return;
  }
  const rect = el.getBoundingClientRect();
  tip.value = {
    show: true,
    x: rect.left + rect.width / 2,
    y: rect.top,
    state: run.state,
    relative: relativeTime(run.createdAt),
    absolute: fmtTime(run.createdAt),
    trigger: run.trigger,
    id: shortId(run.id),
  };
}

function hideTip() {
  tip.value.show = false;
}
</script>

<template>
  <div
    class="run-history-strip"
    :class="{ 'is-live': hasLive }"
    :aria-label="hasLive ? 'Last five runs — task is running' : 'Last five runs'"
  >
    <template v-for="slot in slots" :key="slot.key">
      <span v-if="slot.kind === 'empty'" class="run-strip-cell run-strip-empty" title="No run" />
      <RouterLink
        v-else
        :to="{ name: 'run-detail', params: { id: slot.run.id } }"
        class="run-strip-cell"
        :class="[runStateBadgeClass(slot.run.state), { 'is-live': slot.live }]"
        :aria-label="`${slot.run.state} run ${shortId(slot.run.id)}${slot.live ? ' (in progress)' : ''}`"
        @mouseenter="showTip($event, slot.run)"
        @mouseleave="hideTip"
        @focus="showTip($event, slot.run)"
        @blur="hideTip"
      />
    </template>

    <Teleport to="body">
      <div
        v-if="tip.show"
        class="run-strip-floating-tip timeline-tooltip"
        :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
        role="tooltip"
      >
        <div class="timeline-tooltip-title">{{ tip.state }}</div>
        <div class="timeline-tooltip-detail muted">
          {{ tip.relative }} · {{ tip.absolute }}
        </div>
        <div class="timeline-tooltip-detail muted">{{ tip.trigger }} · {{ tip.id }}</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.run-history-strip {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-height: 28px;
  padding: 2px 0;
}

.run-history-strip.is-live {
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--blue) 18%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--blue) 40%, transparent);
}

.run-strip-cell {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid transparent;
  flex-shrink: 0;
  text-decoration: none;
  transition:
    width 0.15s ease,
    height 0.15s ease,
    box-shadow 0.15s ease;
}

.run-strip-cell.is-live {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border-width: 2px;
  border-color: color-mix(in srgb, var(--blue) 70%, var(--text));
  box-shadow:
    0 0 0 0 color-mix(in srgb, var(--blue) 55%, transparent),
    0 0 14px color-mix(in srgb, var(--blue) 50%, transparent);
  animation: run-strip-live-pulse 1.15s ease-out infinite;
  z-index: 1;
}

.run-strip-empty {
  background: color-mix(in srgb, var(--text-muted) 18%, transparent);
  border-color: color-mix(in srgb, var(--border) 80%, transparent);
  pointer-events: none;
}

a.run-strip-cell:hover,
a.run-strip-cell:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 1px;
}

@keyframes run-strip-live-pulse {
  0% {
    box-shadow:
      0 0 0 0 color-mix(in srgb, var(--blue) 60%, transparent),
      0 0 12px color-mix(in srgb, var(--blue) 45%, transparent);
    transform: scale(1);
  }
  55% {
    box-shadow:
      0 0 0 12px color-mix(in srgb, var(--blue) 0%, transparent),
      0 0 22px color-mix(in srgb, var(--blue) 60%, transparent);
    transform: scale(1.15);
  }
  100% {
    box-shadow:
      0 0 0 0 color-mix(in srgb, var(--blue) 0%, transparent),
      0 0 12px color-mix(in srgb, var(--blue) 40%, transparent);
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .run-strip-cell.is-live {
    animation: none;
    outline: 2px solid var(--blue);
    outline-offset: 2px;
  }
}
</style>

<style>
/* Unscoped: teleported to body; must not use % max-width of a 14px cell. */
.run-strip-floating-tip {
  position: fixed;
  z-index: 1000;
  max-width: 320px;
  transform: translate(-50%, calc(-100% - 8px));
  white-space: nowrap;
  pointer-events: none;
}
</style>
