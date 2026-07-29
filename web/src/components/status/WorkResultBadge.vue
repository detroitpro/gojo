<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { workResultStatus } from "@/lib/status-icons";
import type { WorkItem } from "@/types";

const props = withDefaults(
  defineProps<{
    item: Pick<WorkItem, "resolution" | "delivery" | "outcome">;
    showLabel?: boolean;
  }>(),
  { showLabel: false },
);

const spec = computed(() => workResultStatus(props.item));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
