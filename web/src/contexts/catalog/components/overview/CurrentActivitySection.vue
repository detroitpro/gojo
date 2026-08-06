<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import type { WorkItem } from "@/contexts/work/contract";
import {
  executionStageLabel,
  formatRelativeTime,
  isActiveWork,
} from "@/kernel/project-overview";
import {
  workAgentProfileLabel,
  workPrimaryLabel,
  workSecondaryLabel,
} from "@/kernel/work-display";
import ExecutionBadge from "@/ui/status/ExecutionBadge.vue";

const props = defineProps<{
  items: WorkItem[];
}>();

const active = computed(() => props.items.filter(isActiveWork));
</script>

<template>
  <section
    v-if="active.length > 0"
    class="current-activity"
    aria-labelledby="current-activity-heading"
  >
    <div class="list-section__header">
      <h2 id="current-activity-heading" class="list-section__title">In progress</h2>
      <span class="list-section__meta">{{ active.length }}</span>
    </div>
    <ul class="current-activity__list">
      <li v-for="item in active" :key="item.id" class="current-activity__item">
        <div>
          <RouterLink
            v-if="item.kind === 'run' && item.nativeKey"
            :to="{ name: 'run-detail', params: { id: item.nativeKey } }"
            class="entity-name"
          >
            {{ item.title || workPrimaryLabel(item) }}
          </RouterLink>
          <a
            v-else-if="item.webUrl"
            :href="item.webUrl"
            class="entity-name"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ item.title || workPrimaryLabel(item) }}
          </a>
          <span v-else class="entity-name">{{ item.title || workPrimaryLabel(item) }}</span>
          <p v-if="workSecondaryLabel(item)" class="muted text-sm">
            {{ workSecondaryLabel(item) }}
          </p>
          <p class="muted text-sm current-activity__meta">
            <ExecutionBadge :execution="item.execution" :show-label="true" />
            <span>{{ executionStageLabel(item.execution) }}</span>
            <span aria-hidden="true">·</span>
            <span>Started {{ formatRelativeTime(item.startedAt ?? item.createdAt) }}</span>
            <span aria-hidden="true">·</span>
            <span>Agent: {{ workAgentProfileLabel(item) }}</span>
          </p>
        </div>
        <RouterLink
          v-if="item.kind === 'run' && item.nativeKey"
          :to="{ name: 'run-detail', params: { id: item.nativeKey } }"
          class="text-sm"
        >
          View live run
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.current-activity {
  margin-bottom: 1.75rem;
}

.current-activity__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.current-activity__item {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid var(--border);
}

.current-activity__item:last-child {
  border-bottom: 0;
}

.current-activity__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  margin: 0.4rem 0 0;
}

.current-activity__item p {
  margin: 0.25rem 0 0;
}
</style>
