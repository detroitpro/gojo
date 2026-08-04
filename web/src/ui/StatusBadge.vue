<script setup lang="ts">
import type { Component } from "vue";

import UiIcon from "@/ui/UiIcon.vue";
import { badgeToneClass, type BadgeTone } from "@/kernel/status-icons";

withDefaults(
  defineProps<{
    label: string;
    icon: Component;
    tone?: BadgeTone;
    showLabel?: boolean;
  }>(),
  {
    tone: "neutral",
    showLabel: true,
  },
);
</script>

<template>
  <span
    class="badge"
    :class="[badgeToneClass(tone), { 'badge--icon-only': !showLabel }]"
    :aria-label="label"
    :title="label"
  >
    <UiIcon :icon="icon" class="badge__icon" :size="12" />
    <span v-if="showLabel" class="badge__label">{{ label }}</span>
  </span>
</template>
