<script setup lang="ts">
import { RouterLink } from "vue-router";

import type { ChangeDayGroup, CompletedWorkPresentation } from "@/kernel/project-overview";

import ChangeRow from "./ChangeRow.vue";

defineProps<{
  groups: ChangeDayGroup[];
  impactByRun: Record<string, string[]>;
  loading?: boolean;
  error?: string | null;
  emptyMessage: string;
  emptyHint?: string | null;
  projectId: string;
}>();

const emit = defineEmits<{
  retry: [];
}>();

function categoriesFor(item: CompletedWorkPresentation, impactByRun: Record<string, string[]>): string[] {
  if (!item.runId) return [];
  return impactByRun[item.runId] ?? [];
}
</script>

<template>
  <div class="change-feed">
    <div v-if="loading && groups.length === 0" class="muted text-sm">Loading recent changes…</div>
    <div v-else-if="error && groups.length === 0" class="alert alert-error">
      <p>{{ error }}</p>
      <button type="button" class="btn btn-sm mt-3" @click="emit('retry')">Retry</button>
    </div>
    <div v-else-if="groups.length === 0" class="change-feed__empty">
      <p>{{ emptyMessage }}</p>
      <p v-if="emptyHint" class="muted text-sm mt-2">{{ emptyHint }}</p>
    </div>
    <template v-else>
      <section
        v-for="(group, index) in groups"
        :key="group.key"
        class="change-feed__day"
        :class="{ 'change-feed__day--first': index === 0 }"
      >
        <h3 class="change-feed__day-label">{{ group.label }}</h3>
        <ul class="change-feed__list">
          <ChangeRow
            v-for="item in group.items"
            :key="item.id"
            :item="item"
            :categories="categoriesFor(item, impactByRun)"
          />
        </ul>
      </section>
      <div class="change-feed__footer">
        <RouterLink
          class="text-sm"
          :to="{ name: 'project-history', params: { id: projectId } }"
        >
          View all history
        </RouterLink>
      </div>
    </template>
  </div>
</template>

<style scoped>
.change-feed__empty {
  padding: 0.5rem 0 0.25rem;
}

.change-feed__day {
  margin-top: 0.65rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--border);
}

.change-feed__day--first {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.change-feed__day-label {
  margin: 0 0 0.25rem;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.change-feed__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.change-feed__footer {
  margin-top: 0.65rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
}
</style>
