<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/ui/StatusBadge.vue";
import { deliveryStatus } from "@/kernel/status-icons";
import type { WorkDelivery } from "@gojo/contracts/types";

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
