<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/ui/StatusBadge.vue";
import { channelTypeStatus } from "@/kernel/status-icons";

const props = withDefaults(
  defineProps<{
    type: string;
    showLabel?: boolean;
  }>(),
  { showLabel: true },
);

const spec = computed(() => channelTypeStatus(props.type));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
