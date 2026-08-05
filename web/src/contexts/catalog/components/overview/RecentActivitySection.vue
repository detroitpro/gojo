<script setup lang="ts">
import type { ActivityRangePreset, ActivitySummaryMetrics, CompletedWorkPresentation } from "@/kernel/project-overview";

import ActivityRangeSelector from "./ActivityRangeSelector.vue";
import ActivitySummary from "./ActivitySummary.vue";
import CompletedWorkList from "./CompletedWorkList.vue";
import ProgressSummary from "./ProgressSummary.vue";

const preset = defineModel<ActivityRangePreset>("preset", { required: true });
const customFrom = defineModel<string>("customFrom", { default: "" });
const customTo = defineModel<string>("customTo", { default: "" });

defineProps<{
  rangeLabel: string;
  hasLastCheck: boolean;
  metrics: ActivitySummaryMetrics;
  items: CompletedWorkPresentation[];
  loading?: boolean;
  error?: string | null;
  emptyMessage: string;
  emptyHint?: string | null;
  progressText: string;
  projectId: string;
}>();

const emit = defineEmits<{
  retry: [];
  regenerate: [];
}>();
</script>

<template>
  <section class="recent-activity panel mb-7" aria-labelledby="recent-activity-heading">
    <div class="panel-header recent-activity__header">
      <h2 id="recent-activity-heading">{{ rangeLabel }}</h2>
      <ActivityRangeSelector
        v-model:preset="preset"
        v-model:custom-from="customFrom"
        v-model:custom-to="customTo"
        :has-last-check="hasLastCheck"
      />
    </div>
    <div class="panel-body">
      <ActivitySummary :metrics="metrics" :range-label="rangeLabel" :loading="loading" />
      <ProgressSummary
        v-if="!loading && items.length > 0"
        :text="progressText"
        :range-label="rangeLabel"
        :derived="true"
        :supporting-to="{ name: 'project-history', params: { id: projectId } }"
        @regenerate="emit('regenerate')"
      />
      <CompletedWorkList
        :items="items"
        :loading="loading"
        :error="error"
        :empty-message="emptyMessage"
        :empty-hint="emptyHint"
        @retry="emit('retry')"
      />
    </div>
  </section>
</template>

<style scoped>
.recent-activity__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.recent-activity__header h2 {
  margin: 0;
  font-size: 1.05rem;
}
</style>
