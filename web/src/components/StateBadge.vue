<script setup lang="ts">
import { computed } from "vue";

import { runStateBadgeClass } from "@/lib/run-state-badge";
import type { RunState } from "@/types";

const props = defineProps<{
  state: RunState | string;
}>();

const badgeClass = computed(() => runStateBadgeClass(props.state));
</script>

<template>
  <span class="badge" :class="badgeClass">{{ state }}</span>
</template>
