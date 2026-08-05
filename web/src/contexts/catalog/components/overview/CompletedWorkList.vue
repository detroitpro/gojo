<script setup lang="ts">
import type { CompletedWorkPresentation } from "@/kernel/project-overview";

import CompletedWorkItem from "./CompletedWorkItem.vue";

defineProps<{
  items: CompletedWorkPresentation[];
  loading?: boolean;
  emptyMessage: string;
  emptyHint?: string | null;
  error?: string | null;
}>();

const emit = defineEmits<{
  retry: [];
}>();
</script>

<template>
  <div class="completed-work-list">
    <div v-if="loading" class="muted text-sm">Loading completed work…</div>
    <div v-else-if="error" class="alert alert-error">
      <p>{{ error }}</p>
      <button type="button" class="btn btn-sm mt-3" @click="emit('retry')">Retry</button>
    </div>
    <div v-else-if="items.length === 0" class="completed-work-list__empty">
      <p>{{ emptyMessage }}</p>
      <p v-if="emptyHint" class="muted text-sm mt-2">{{ emptyHint }}</p>
    </div>
    <div v-else>
      <CompletedWorkItem v-for="item in items" :key="item.id" :item="item" />
    </div>
  </div>
</template>

<style scoped>
.completed-work-list__empty {
  padding: 0.5rem 0 0.25rem;
}
</style>
