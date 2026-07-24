<script setup lang="ts">
import { computed, ref, watch } from "vue";

import TablePager from "@/components/TablePager.vue";
import { useClientPager } from "@/composables/useClientPager";
import { fmtDuration, fmtTime } from "@/lib/format";
import {
  buildActivityItems,
  type ActivityItem,
  type ActivityKind,
} from "@/lib/run-activity";
import type { PhaseKey } from "@/lib/run-phases";
import type { RunEvent } from "@/types";

const props = defineProps<{
  events: RunEvent[];
  phaseFilter?: PhaseKey | null;
  highlightId?: string | null;
}>();

const PAGE_SIZE = 10;

const kindFilter = ref<ActivityKind | "all">("all");
const query = ref("");
const expanded = ref<Record<string, boolean>>({});

const allItems = computed(() => buildActivityItems(props.events));

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return allItems.value.filter((item) => {
    if (props.phaseFilter && item.phase !== props.phaseFilter) {
      return false;
    }
    if (kindFilter.value !== "all" && item.kind !== kindFilter.value) {
      return false;
    }
    if (!q) {
      return true;
    }
    return (
      item.title.toLowerCase().includes(q) ||
      (item.detail?.toLowerCase().includes(q) ?? false) ||
      (item.body?.toLowerCase().includes(q) ?? false)
    );
  });
});

const { page, pages, pageItems, total, rangeLabel, reset } = useClientPager(filtered, PAGE_SIZE);

// Auto-expand the newest assistant/stderr message so live thinking is visible.
watch(
  pageItems,
  (rows) => {
    const newest = rows.find((row) => row.kind === "assistant" || row.body);
    if (newest && expanded.value[newest.id] === undefined) {
      expanded.value = { ...expanded.value, [newest.id]: true };
    }
  },
  { immediate: true },
);

watch([() => props.phaseFilter, kindFilter, query], () => {
  reset();
});

watch(
  () => props.highlightId,
  (id) => {
    if (!id) {
      return;
    }
    const index = filtered.value.findIndex((item) => item.id === id);
    if (index >= 0) {
      page.value = Math.floor(index / PAGE_SIZE) + 1;
      expanded.value = { ...expanded.value, [id]: true };
    }
  },
);

function toggle(id: string) {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] };
}

function statusClass(item: ActivityItem): string {
  return `kind-${item.status ?? "info"}`;
}
</script>

<template>
  <div class="activity-panel">
    <div class="activity-filters">
      <select v-model="kindFilter" class="select">
        <option value="all">All kinds</option>
        <option value="lifecycle">Lifecycle</option>
        <option value="agent">Agent</option>
        <option value="assistant">Assistant</option>
        <option value="tool">Tools</option>
        <option value="validation">Validation</option>
        <option value="artifact">Artifacts</option>
        <option value="error">Errors</option>
      </select>
      <input
        v-model="query"
        class="input"
        type="search"
        placeholder="Filter activity…"
      />
      <span class="muted">{{ total }} events</span>
    </div>

    <ul v-if="pageItems.length" class="activity-feed">
      <li
        v-for="row in pageItems"
        :id="`activity-${row.id}`"
        :key="row.id"
        class="activity-row"
        :class="[statusClass(row), { highlighted: highlightId === row.id }]"
      >
        <span class="time">{{ fmtTime(row.at) }}</span>
        <div class="activity-body">
          <div class="activity-title">{{ row.title }}</div>
          <div v-if="row.detail" class="activity-detail muted">{{ row.detail }}</div>

          <template v-if="row.body">
            <button class="btn btn-sm mt-2" type="button" @click="toggle(row.id)">
              {{ expanded[row.id] ? "Hide message" : "Show message" }}
            </button>
            <pre
              v-if="expanded[row.id]"
              class="pre-block mt-2 activity-assistant-body"
              >{{ row.body }}</pre
            >
          </template>

          <template v-if="row.validation">
            <div class="activity-meta mono muted">
              {{ row.validation.command }} · {{ fmtDuration(row.validation.durationMs) }}
            </div>
            <button class="btn btn-sm mt-2" type="button" @click="toggle(row.id)">
              {{ expanded[row.id] ? "Hide output" : "Show output" }}
            </button>
            <div v-if="expanded[row.id]" class="validation-output mt-2">
              <pre v-if="row.validation.stdout" class="pre-block">{{ row.validation.stdout }}</pre>
              <pre v-if="row.validation.stderr" class="pre-block pre-stderr">{{
                row.validation.stderr
              }}</pre>
              <div
                v-if="!row.validation.stdout && !row.validation.stderr"
                class="muted"
              >
                No stdout/stderr captured for this step.
              </div>
            </div>
          </template>
        </div>
      </li>
    </ul>
    <div v-else class="muted">No activity matches this filter.</div>

    <TablePager
      v-model:page="page"
      :page-count="pages"
      :range-label="rangeLabel"
      :total="total"
    />
  </div>
</template>
