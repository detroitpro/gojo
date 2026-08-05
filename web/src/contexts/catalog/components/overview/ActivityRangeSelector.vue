<script setup lang="ts">
import type { ActivityRangePreset } from "@/kernel/project-overview";

const preset = defineModel<ActivityRangePreset>("preset", { required: true });
const customFrom = defineModel<string>("customFrom", { default: "" });
const customTo = defineModel<string>("customTo", { default: "" });

defineProps<{
  hasLastCheck: boolean;
}>();
</script>

<template>
  <div class="activity-range">
    <label class="sr-only" for="activity-range-preset">Activity time range</label>
    <select
      id="activity-range-preset"
      v-model="preset"
      class="select"
      aria-label="Activity time range"
    >
      <option v-if="hasLastCheck" value="last-check">Since last check</option>
      <option value="24h">Last 24 hours</option>
      <option value="7d">Last 7 days</option>
      <option value="custom">Custom range</option>
    </select>
    <template v-if="preset === 'custom'">
      <label class="sr-only" for="activity-range-from">From</label>
      <input
        id="activity-range-from"
        v-model="customFrom"
        class="input"
        type="datetime-local"
        aria-label="Custom range start"
      />
      <label class="sr-only" for="activity-range-to">To</label>
      <input
        id="activity-range-to"
        v-model="customTo"
        class="input"
        type="datetime-local"
        aria-label="Custom range end"
      />
    </template>
  </div>
</template>

<style scoped>
.activity-range {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
