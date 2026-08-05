<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import {
  listProjectSources,
  listProjectWork,
  useWorkStore,
} from "@/contexts/work/contract";
import type { ProjectSource, WorkItem } from "@/contexts/work/types";
import {
  DEFAULT_PAGE_LIMIT,
  pageCount,
  rangeLabel as formatRangeLabel,
} from "@/kernel/pagination";
import {
  collapseHistoryTimeline,
  workAgentProfileLabel,
  workHistoryHref,
  workPrimaryLabel,
  workSecondaryLabel,
} from "@/kernel/work-display";
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import TablePager from "@/ui/TablePager.vue";
import WorkKindBadge from "@/ui/status/WorkKindBadge.vue";
import WorkResultBadge from "@/ui/status/WorkResultBadge.vue";

const props = defineProps<{
  projectId: string;
}>();

const historyItems = ref<WorkItem[]>([]);
const historyTotal = ref(0);
const projectSources = ref<ProjectSource[]>([]);
const page = ref(1);
const limit = DEFAULT_PAGE_LIMIT;

const historyRows = computed(() => collapseHistoryTimeline(historyItems.value));
const pages = computed(() => pageCount(historyTotal.value, limit));
const rangeLabel = computed(() =>
  formatRangeLabel(historyTotal.value, limit, (page.value - 1) * limit),
);

const sourceNames = computed(
  () => new Map(projectSources.value.map((source) => [source.id, source.displayName])),
);

function sourceLabel(item: WorkItem): string {
  if (item.sourceId) return sourceNames.value.get(item.sourceId) ?? item.sourceId;
  return item.provenance === "gojo-agent" ? "gojo" : "local";
}

function historyRunId(item: WorkItem): string | null {
  const href = workHistoryHref(item);
  return href?.type === "run" ? href.id : null;
}

function historyExternalUrl(item: WorkItem): string | null {
  const href = workHistoryHref(item);
  return href?.type === "external" ? href.url : null;
}

async function loadHistory() {
  try {
    const offset = (page.value - 1) * limit;
    const [history, sources] = await Promise.all([
      listProjectWork(props.projectId, {
        limit,
        offset,
        history: true,
      }),
      listProjectSources(props.projectId),
    ]);
    historyItems.value = history.items;
    historyTotal.value = history.total;
    projectSources.value = sources;
    const maxPage = pageCount(history.total, limit);
    if (page.value > maxPage) {
      page.value = maxPage;
    }
  } catch {
    historyItems.value = [];
    historyTotal.value = 0;
    projectSources.value = [];
  }
}

watch(
  () => props.projectId,
  () => {
    page.value = 1;
    historyItems.value = [];
    historyTotal.value = 0;
    void loadHistory();
  },
);

watch(page, () => {
  void loadHistory();
});

const workStore = useWorkStore();
bindStoreRefresh(workStore, loadHistory);
</script>

<template>
  <section class="list-section">
    <div class="list-section__header">
      <div>
        <h2 class="list-section__title">History</h2>
        <p class="muted text-sm mt-1">
          Completed runs and verified merged/closed delivery
        </p>
      </div>
      <span class="list-section__meta">{{ historyTotal }}</span>
    </div>
    <div v-if="historyRows.length === 0" class="muted text-sm">No completed work yet</div>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Type</th>
            <th>Work</th>
            <th>Agent / profile</th>
            <th>Result</th>
            <th>Platform / repo</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in historyRows"
            :key="row.nested ? `${row.parentId}:${row.item.id}` : row.item.id"
            :class="{ 'history-row--nested': row.nested }"
          >
            <td><WorkKindBadge :kind="row.item.kind" /></td>
            <td :class="{ 'history-work--nested': row.nested }">
              <RouterLink
                v-if="historyRunId(row.item)"
                :to="{ name: 'run-detail', params: { id: historyRunId(row.item)! } }"
                class="entity-name"
              >{{ workPrimaryLabel(row.item) }}</RouterLink>
              <a
                v-else-if="historyExternalUrl(row.item)"
                :href="historyExternalUrl(row.item)!"
                class="entity-name"
                target="_blank"
                rel="noopener noreferrer"
              >{{ workPrimaryLabel(row.item) }}</a>
              <span v-else>{{ workPrimaryLabel(row.item) }}</span>
              <div v-if="workSecondaryLabel(row.item)" class="muted text-sm">
                {{ workSecondaryLabel(row.item) }}
              </div>
            </td>
            <td>{{ workAgentProfileLabel(row.item) }}</td>
            <td><WorkResultBadge :item="row.item" /></td>
            <td>{{ sourceLabel(row.item) }}</td>
            <td class="mono muted">
              {{
                new Date(
                  row.item.resolvedAt ?? row.item.completedAt ?? row.item.updatedAt,
                ).toLocaleString()
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <TablePager
      v-model:page="page"
      :page-count="pages"
      :range-label="rangeLabel"
      :total="historyTotal"
    />
  </section>
</template>

<style scoped>
.history-row--nested td {
  background: color-mix(in srgb, var(--bg) 65%, transparent);
  color: var(--text-muted);
}

.history-work--nested {
  padding-left: calc(var(--space-4) + 1rem);
  position: relative;
}

.history-work--nested::before {
  content: "";
  position: absolute;
  left: 0.35rem;
  top: 0.55rem;
  width: 0.55rem;
  height: 0.55rem;
  border-left: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
</style>
