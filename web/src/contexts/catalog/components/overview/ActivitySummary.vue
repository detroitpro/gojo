<script setup lang="ts">
import type { ActivitySummaryMetrics } from "@/kernel/project-overview";
import { formatActivitySummaryLine } from "@/kernel/project-overview";

defineProps<{
  metrics: ActivitySummaryMetrics;
  rangeLabel: string;
  loading?: boolean;
}>();
</script>

<template>
  <div class="activity-summary" aria-live="polite">
    <p v-if="loading" class="muted text-sm">Loading activity summary…</p>
    <p v-else class="activity-summary__line">
      <span class="activity-summary__range muted text-sm">{{ rangeLabel }}</span>
      <span>{{ formatActivitySummaryLine(metrics) }}</span>
    </p>
  </div>
</template>

<style scoped>
.activity-summary {
  margin-bottom: 1rem;
}

.activity-summary__line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin: 0;
  font-size: 0.95rem;
}

.activity-summary__range {
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
</style>
