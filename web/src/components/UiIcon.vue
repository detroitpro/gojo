<script setup lang="ts">
import type { Component } from "vue";

withDefaults(
  defineProps<{
    icon: Component;
    size?: number;
    strokeWidth?: number;
  }>(),
  {
    size: 14,
    strokeWidth: 2,
  },
);
</script>

<template>
  <component
    :is="icon"
    class="ui-icon"
    :size="size"
    :stroke-width="strokeWidth"
    aria-hidden="true"
  />
</template>
