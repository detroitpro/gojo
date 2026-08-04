<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/ui/StatusBadge.vue";
import { integrationStatus } from "@/kernel/status-icons";

const props = withDefaults(
  defineProps<{
    status: string;
    showLabel?: boolean;
  }>(),
  { showLabel: true },
);

const spec = computed(() => integrationStatus(props.status));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
