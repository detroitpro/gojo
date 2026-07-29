<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { workKindStatus } from "@/lib/status-icons";

const props = withDefaults(
  defineProps<{
    kind: string;
    showLabel?: boolean;
  }>(),
  { showLabel: false },
);

const spec = computed(() => workKindStatus(props.kind));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
