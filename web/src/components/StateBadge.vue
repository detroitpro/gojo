<script setup lang="ts">
import { computed } from "vue";

import type { RunState } from "@/types";

const props = defineProps<{
  state: RunState | string;
}>();

const badgeClass = computed(() => {
  const s = props.state;
  if (["Running", "Preparing", "Validating", "Integrating", "Reporting"].includes(s)) {
    return "badge-running";
  }
  if (["Queued", "Scheduled"].includes(s)) {
    return "badge-queued";
  }
  if (s === "Succeeded") {
    return "badge-success";
  }
  if (["Failed", "Canceled", "TimedOut", "InfrastructureFailure", "Conflict"].includes(s)) {
    return "badge-failed";
  }
  if (s === "AwaitingApproval") {
    return "badge-warn";
  }
  return "badge-neutral";
});
</script>

<template>
  <span class="badge" :class="badgeClass">{{ state }}</span>
</template>
