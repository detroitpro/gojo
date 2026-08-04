<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/ui/StatusBadge.vue";
import { syncStateStatus } from "@/kernel/status-icons";
import type { SourceSyncState } from "@gojo/contracts/types";

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
