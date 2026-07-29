<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { healthStatus } from "@/lib/status-icons";

const props = withDefaults(
  defineProps<{
    level: "ok" | "warn" | "error" | "missing" | string;
    label?: string;
    showLabel?: boolean;
  }>(),
  { showLabel: true },
);

const spec = computed(() => healthStatus(props.level));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="label ?? spec.label"
    :show-label="showLabel"
  />
</template>
