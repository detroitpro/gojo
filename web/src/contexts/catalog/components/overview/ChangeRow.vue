<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import type { CompletedWorkPresentation } from "@/kernel/project-overview";
import { impactCategoryLabel } from "@/kernel/impact-format";
import WorkResultBadge from "@/ui/status/WorkResultBadge.vue";

const props = defineProps<{
  item: CompletedWorkPresentation;
  categories?: string[];
}>();

const MAX_CHIPS = 2;

const visibleCategories = computed(() => (props.categories ?? []).slice(0, MAX_CHIPS));
const extraCategoryCount = computed(() =>
  Math.max(0, (props.categories?.length ?? 0) - MAX_CHIPS),
);

const secondaryLine = computed(() => {
  const parts = [props.item.agentLabel, props.item.description].filter(
    (part): part is string => Boolean(part?.trim()),
  );
  return parts.join(" · ") || null;
});
</script>

<template>
  <li class="change-row">
    <span class="change-row__status" :title="item.statusLabel">
      <WorkResultBadge :item="item.resultItem" />
    </span>

    <div class="change-row__main">
      <RouterLink
        v-if="item.runId"
        :to="{ name: 'run-detail', params: { id: item.runId } }"
        class="change-row__title"
      >
        {{ item.outcomeTitle }}
      </RouterLink>
      <a
        v-else-if="item.externalUrl"
        :href="item.externalUrl"
        class="change-row__title"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ item.outcomeTitle }}
      </a>
      <span v-else class="change-row__title">{{ item.outcomeTitle }}</span>
      <p v-if="secondaryLine" class="change-row__secondary muted">{{ secondaryLine }}</p>
    </div>

    <div class="change-row__chips">
      <span
        v-for="category in visibleCategories"
        :key="category"
        class="badge badge-neutral"
      >
        {{ impactCategoryLabel(category) }}
      </span>
      <span v-if="extraCategoryCount > 0" class="badge badge-neutral">
        +{{ extraCategoryCount }}
      </span>
      <a
        v-if="item.prRef?.url"
        :href="item.prRef.url"
        class="badge badge-neutral change-row__pr mono"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ item.prRef.label }}
      </a>
      <span v-else-if="item.prRef" class="badge badge-neutral change-row__pr mono">
        {{ item.prRef.label }}
      </span>
    </div>

    <time
      class="change-row__time mono muted"
      :datetime="item.completedAt ?? undefined"
      :title="item.completedRelative"
    >
      {{ item.clockTime }}
    </time>
  </li>
</template>

<style scoped>
.change-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto 4.75rem;
  gap: var(--space-4);
  align-items: baseline;
  padding: 5px 6px;
  margin-inline: -6px;
  border-radius: var(--radius-sm);
  list-style: none;
}

.change-row:hover {
  background: var(--row-hover);
}

.change-row__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.change-row__main {
  min-width: 0;
}

.change-row__title {
  display: block;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--text);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

a.change-row__title:hover {
  color: var(--accent-hover);
}

.change-row__secondary {
  margin: 1px 0 0;
  font-size: 11px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-row__chips {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  max-width: 16rem;
  overflow: hidden;
}

.change-row__pr {
  text-decoration: none;
}

a.change-row__pr:hover {
  border-color: var(--accent-line);
  color: var(--accent);
}

.change-row__time {
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .change-row {
    grid-template-columns: 18px minmax(0, 1fr) 3.5rem;
  }

  .change-row__chips {
    display: none;
  }
}
</style>
