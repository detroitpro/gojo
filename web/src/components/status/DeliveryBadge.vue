<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { deliveryStatus } from "@/lib/status-icons";
import type { WorkDelivery } from "@/types";

const props = withDefaults(
  defineProps<{
    delivery: WorkDelivery | string;
    showLabel?: boolean;
  }>(),
  { showLabel: false },
);

const spec = computed(() => deliveryStatus(props.delivery));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
