<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { integrationStatus } from "@/lib/status-icons";

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
