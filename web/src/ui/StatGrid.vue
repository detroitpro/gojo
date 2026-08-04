<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="stat-grid-wrap">
    <div v-if="title" class="stat-grid__title">{{ title }}</div>
    <div class="stat-grid">
      <slot />
    </div>
  </div>
</template>
