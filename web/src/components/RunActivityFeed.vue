<script setup lang="ts">
import { computed, ref, watch } from "vue";

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
const page = ref(1);
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
      (item.detail?.toLowerCase().includes(q) ?? false)
    );
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));

const pageItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filtered.value.slice(start, start + PAGE_SIZE);
});

watch([() => props.phaseFilter, kindFilter, query], () => {
  page.value = 1;
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
      <span class="muted">{{ filtered.length }} events</span>
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

    <div v-if="pageCount > 1" class="activity-pager">
      <button class="btn btn-sm" type="button" :disabled="page <= 1" @click="page -= 1">
        Prev
      </button>
      <span class="muted">Page {{ page }} / {{ pageCount }}</span>
      <button
        class="btn btn-sm"
        type="button"
        :disabled="page >= pageCount"
        @click="page += 1"
      >
        Next
      </button>
    </div>
  </div>
</template>
