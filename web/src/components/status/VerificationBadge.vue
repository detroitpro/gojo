<script setup lang="ts">
import { computed } from "vue";

import StatusBadge from "@/components/StatusBadge.vue";
import { verificationStatus } from "@/lib/status-icons";

const props = withDefaults(
  defineProps<{
    verification: string;
    showLabel?: boolean;
  }>(),
  { showLabel: true },
);

const spec = computed(() => verificationStatus(props.verification));
</script>

<template>
  <StatusBadge
    :icon="spec.icon"
    :tone="spec.tone"
    :label="spec.label"
    :show-label="showLabel"
  />
</template>
