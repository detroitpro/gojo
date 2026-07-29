<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { provenanceStatus } from "@/lib/status-icons";

const props = withDefaults(
  defineProps<{
    provenance: string;
    showLabel?: boolean;
  }>(),
  { showLabel: false },
);

const spec = computed(() => provenanceStatus(props.provenance));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
