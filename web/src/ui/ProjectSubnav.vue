<script setup lang="ts">
import type { Component } from "vue";
import { useRoute } from "vue-router";

import AppButton from "@/ui/AppButton.vue";

export type ProjectSubnavItem = {
  name: string;
  label: string;
  to: string | Record<string, unknown>;
  icon: Component;
};

defineProps<{
  items: ProjectSubnavItem[];
}>();

const route = useRoute();
</script>

<template>
  <nav class="filter-bar mb-7" aria-label="Project sections">
    <div class="btn-row">
      <AppButton
        v-for="item in items"
        :key="item.name"
        size="sm"
        variant="ghost"
        :icon="item.icon"
        :selected="route.name === item.name"
        :to="item.to"
      >
        {{ item.label }}
      </AppButton>
    </div>
  </nav>
</template>
