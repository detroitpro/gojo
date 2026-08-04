<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/ui/StatusBadge.vue";
import { executionStatus } from "@/kernel/status-icons";
import type { WorkExecution } from "@gojo/contracts/types";

const props = withDefaults(
  defineProps<{
    execution: WorkExecution | string;
    showLabel?: boolean;
  }>(),
  { showLabel: false },
);

const spec = computed(() => executionStatus(props.execution));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
