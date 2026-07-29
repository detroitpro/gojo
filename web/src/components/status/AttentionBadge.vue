<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { attentionStatus } from "@/lib/status-icons";
import type { WorkAttention } from "@/types";

const props = withDefaults(
  defineProps<{
    attention: WorkAttention | string;
    showLabel?: boolean;
  }>(),
  { showLabel: true },
);

const spec = computed(() => attentionStatus(props.attention));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
