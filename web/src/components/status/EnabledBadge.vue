<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { enabledStatus } from "@/lib/status-icons";

const props = withDefaults(
  defineProps<{
    enabled: boolean;
    showLabel?: boolean;
  }>(),
  { showLabel: true },
);

const spec = computed(() => enabledStatus(props.enabled));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
