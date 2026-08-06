<script setup lang="ts">
import { computed } from "vue";
import { AlertTriangle, CheckCircle2, ExternalLink, Play, RefreshCw } from "lucide-vue-next";

import type { WorkItem } from "@/contexts/work/contract";
import {
  attentionMenuItems,
  attentionPrimaryAction,
  workExternalHref,
} from "@/kernel/work-attention";
import { presentAttentionItem } from "@/kernel/project-overview";
import ActionMenu from "@/ui/ActionMenu.vue";
import AppButton from "@/ui/AppButton.vue";
import UiIcon from "@/ui/UiIcon.vue";
import AttentionBadge from "@/ui/status/AttentionBadge.vue";

const props = defineProps<{
  items: WorkItem[];
  sourceWebUrls: Map<string, string | null>;
  busyId?: string;
  /** When true, render the quiet healthy line instead of omitting entirely. */
  showHealthy?: boolean;
}>();

const emit = defineEmits<{
  primaryAction: [item: WorkItem];
  menuAction: [item: WorkItem, actionId: string];
}>();

const presented = computed(() => props.items.map((item) => presentAttentionItem(item)));

function sourceUrl(item: WorkItem): string | null {
  if (!item.sourceId) return null;
  return props.sourceWebUrls.get(item.sourceId) ?? null;
}

function primary(item: WorkItem) {
  return attentionPrimaryAction(item, sourceUrl(item));
}

function menuItems(item: WorkItem) {
  return attentionMenuItems(item, sourceUrl(item));
}

function href(item: WorkItem) {
  return workExternalHref(item, sourceUrl(item));
}
</script>

<template>
  <section
    v-if="presented.length > 0"
    class="attention-summary"
    aria-labelledby="attention-heading"
  >
    <div class="attention-summary__header">
      <UiIcon :icon="AlertTriangle" :size="18" class="attention-summary__icon" aria-hidden="true" />
      <h2 id="attention-heading">Needs your attention</h2>
      <span class="list-section__meta">{{ presented.length }}</span>
    </div>
    <ul class="attention-summary__list">
      <li v-for="row in presented" :key="row.id" class="attention-summary__item">
        <div class="attention-summary__body">
          <div class="attention-summary__title-row">
            <a
              v-if="href(row.item)"
              :href="href(row.item)!"
              class="entity-name"
              target="_blank"
              rel="noopener noreferrer"
            >{{ row.title }}</a>
            <span v-else class="entity-name">{{ row.title }}</span>
            <AttentionBadge :attention="row.item.attention" :show-label="true" />
          </div>
          <p class="muted text-sm">{{ row.why }}</p>
          <p class="muted text-sm">{{ row.sinceLabel }} · {{ row.expectedAction }}</p>
        </div>
        <div class="attention-summary__actions">
          <AppButton
            v-if="primary(row.item)?.kind === 'route'"
            variant="primary"
            size="sm"
            :icon="Play"
            :to="(primary(row.item) as Extract<ReturnType<typeof primary>, { kind: 'route' }>).to"
          >
            {{ primary(row.item)?.label }}
          </AppButton>
          <AppButton
            v-else-if="primary(row.item)?.kind === 'href'"
            size="sm"
            :icon="ExternalLink"
            :href="(primary(row.item) as Extract<ReturnType<typeof primary>, { kind: 'href' }>).href"
            target="_blank"
          >
            {{ primary(row.item)?.label }}
          </AppButton>
          <AppButton
            v-else-if="primary(row.item)?.kind === 'action'"
            variant="primary"
            size="sm"
            :icon="RefreshCw"
            :loading="busyId === row.id"
            loading-label="Working…"
            @click="emit('primaryAction', row.item)"
          >
            {{ primary(row.item)?.label }}
          </AppButton>
          <ActionMenu
            :items="menuItems(row.item)"
            :disabled="busyId === row.id"
            :label="`Actions for ${row.title}`"
            @select="(id) => emit('menuAction', row.item, id)"
          />
        </div>
      </li>
    </ul>
  </section>
  <p
    v-else-if="showHealthy"
    class="attention-healthy muted text-sm"
    role="status"
  >
    <UiIcon :icon="CheckCircle2" :size="14" aria-hidden="true" />
    No items need your attention
  </p>
</template>

<style scoped>
.attention-summary {
  margin-bottom: 1.5rem;
  padding: 1rem 1.1rem;
  border: 1px solid color-mix(in srgb, var(--warn, #e3b341) 45%, var(--border));
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--warn, #e3b341) 8%, var(--surface));
}

.attention-summary__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.85rem;
}

.attention-summary__header h2 {
  margin: 0;
  font-size: 1.05rem;
}

.attention-summary__icon {
  color: var(--warn, #e3b341);
}

.attention-summary__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.attention-summary__item {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
}

.attention-summary__item:first-child {
  padding-top: 0;
  border-top: 0;
}

.attention-summary__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.attention-summary__body p {
  margin: 0.2rem 0 0;
}

.attention-summary__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.4rem;
}

.attention-healthy {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 0 1rem;
}
</style>
