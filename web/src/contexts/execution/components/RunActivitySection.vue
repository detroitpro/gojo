<script setup lang="ts">
import type { PhaseKey } from "@/kernel/run-phases";
import type { RunEvent } from "@/contexts/execution/types";
import AppButton from "@/ui/AppButton.vue";
import RunActivityFeed from "@/ui/RunActivityFeed.vue";
import RunTimelineChart from "@/ui/RunTimelineChart.vue";

defineProps<{
  events: RunEvent[];
  selectedPhase: PhaseKey | null;
  highlightActivityId: string | null;
}>();

const emit = defineEmits<{
  "update:selectedPhase": [value: PhaseKey | null];
  "update:highlightActivityId": [value: string | null];
}>();
</script>

<template>
  <section class="panel">
    <div class="panel-header">Timeline</div>
    <div class="panel-body">
      <RunTimelineChart
        :events="events"
        :selected-phase="selectedPhase"
        @select-phase="emit('update:selectedPhase', $event)"
        @select-activity="emit('update:highlightActivityId', $event)"
      />
    </div>
  </section>

  <section class="panel">
    <div class="panel-header">
      Activity
      <AppButton
        v-if="selectedPhase"
        size="sm"
        @click="emit('update:selectedPhase', null)"
      >
        Clear phase filter
      </AppButton>
    </div>
    <div class="panel-body">
      <RunActivityFeed
        :events="events"
        :phase-filter="selectedPhase"
        :highlight-id="highlightActivityId"
      />
    </div>
  </section>
</template>
