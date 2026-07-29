<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { runStateStatus } from "@/lib/status-icons";
import type { RunState } from "@/types";

const props = withDefaults(
  defineProps<{
    state: RunState | string;
    showLabel?: boolean;
  }>(),
  { showLabel: true },
);

const spec = computed(() => runStateStatus(props.state));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
