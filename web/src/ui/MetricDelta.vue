<script setup lang="ts">
import { computed } from "vue";
import { Minus, TrendingDown, TrendingUp } from "lucide-vue-next";

import UiIcon from "@/ui/UiIcon.vue";
import { deltaTone, formatDelta, type MetricDirection } from "@/kernel/stat-metrics";
import { badgeToneClass } from "@/kernel/status-icons";

const props = defineProps<{
  delta: number | null;
  direction: MetricDirection;
  title?: string;
}>();

const visible = computed(() => props.delta !== null);

const toneClass = computed(() => badgeToneClass(deltaTone({ direction: props.direction }, props.delta)));

const trendIcon = computed(() => {
  if (props.delta === null || props.delta === 0) {
    return Minus;
  }
  return props.delta > 0 ? TrendingUp : TrendingDown;
});
</script>

<template>
  <span
    v-if="visible"
    class="metric-delta"
    :class="toneClass"
    :title="title"
    :aria-label="title ? `${formatDelta(delta)} ${title}` : formatDelta(delta)"
  >
    <UiIcon :icon="trendIcon" :size="12" />
    <span class="metric-delta__value">{{ formatDelta(delta) }}</span>
  </span>
</template>
