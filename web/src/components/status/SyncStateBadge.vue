<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { syncStateStatus } from "@/lib/status-icons";
import type { SourceSyncState } from "@/types";

const props = withDefaults(
  defineProps<{
    syncState: SourceSyncState | string;
    showLabel?: boolean;
  }>(),
  { showLabel: true },
);

const spec = computed(() => syncStateStatus(props.syncState));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
