<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { listImpactItems, listProjects } from "@/api";
import SortableTh from "@/components/SortableTh.vue";
import TablePager from "@/components/TablePager.vue";
import UiIcon from "@/components/UiIcon.vue";
import VerificationBadge from "@/components/status/VerificationBadge.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useServerTable } from "@/composables/useServerTable";
import { MAX_PAGE_LIMIT, type SortOrder } from "@/lib/pagination";
import {
  IMPACT_CATEGORIES,
  impactCategoryLabel,
  impactCategorySpec,
} from "@/lib/stat-metrics";
import type { Project } from "@/types";

const IMPACT_SORT_ALLOWED = [
  "createdAt",
  "category",
  "subject",
  "projectName",
  "agentName",
] as const;

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

function initialSort(): string {
  const value = queryParam("sort");
  return (IMPACT_SORT_ALLOWED as readonly string[]).includes(value) ? value : "createdAt";
}

function initialOrder(): SortOrder {
  const value = queryParam("order");
  return value === "asc" || value === "desc" ? value : "desc";
}

const projects = ref<Project[]>([]);
const categoryFilter = ref(queryParam("category"));
const projectFilter = ref(queryParam("projectId"));
const fromFilter = ref(queryParam("from"));
const toFilter = ref(queryParam("to"));
const rangeFilter = ref(queryParam("range"));

const categoryOptions = computed(() =>
  IMPACT_CATEGORIES.map((category) => ({
    value: category,
    label: impactCategoryLabel(category),
  })),
);

const {
  page,
  pages,
  items,
  total,
  loading,
  error,
  sort,
  order,
  setSort,
  rangeLabel,
  load,
} = useServerTable({
  defaultSort: initialSort(),
  defaultOrder: initialOrder(),
  watchSources: [categoryFilter, projectFilter, fromFilter, toFilter],
  fetchPage: ({ limit, offset, sort: sortBy, order: sortOrder }) =>
    listImpactItems({
      limit,
      offset,
      sort: sortBy,
      order: sortOrder,
      category: categoryFilter.value || undefined,
      projectId: projectFilter.value || undefined,
      from: fromFilter.value || undefined,
      to: toFilter.value || undefined,
    }),
});

async function loadProjects() {
  const result = await listProjects({ limit: MAX_PAGE_LIMIT, offset: 0 });
  projects.value = result.items;
}

function formatWhen(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

watch(
  () =>
    [
      route.query.category,
      route.query.projectId,
      route.query.from,
      route.query.to,
      route.query.range,
    ] as const,
  ([category, projectId, from, to, range]) => {
    const nextCategory = typeof category === "string" ? category : "";
    const nextProject = typeof projectId === "string" ? projectId : "";
    const nextFrom = typeof from === "string" ? from : "";
    const nextTo = typeof to === "string" ? to : "";
    const nextRange = typeof range === "string" ? range : "";
    if (categoryFilter.value !== nextCategory) categoryFilter.value = nextCategory;
    if (projectFilter.value !== nextProject) projectFilter.value = nextProject;
    if (fromFilter.value !== nextFrom) fromFilter.value = nextFrom;
    if (toFilter.value !== nextTo) toFilter.value = nextTo;
    if (rangeFilter.value !== nextRange) rangeFilter.value = nextRange;
  },
);

watch([categoryFilter, projectFilter, fromFilter, toFilter, rangeFilter, sort, order], () => {
  const nextQuery = { ...route.query } as Record<string, string>;
  if (categoryFilter.value) nextQuery.category = categoryFilter.value;
  else delete nextQuery.category;
  if (projectFilter.value) nextQuery.projectId = projectFilter.value;
  else delete nextQuery.projectId;
  if (fromFilter.value) nextQuery.from = fromFilter.value;
  else delete nextQuery.from;
  if (toFilter.value) nextQuery.to = toFilter.value;
  else delete nextQuery.to;
  if (rangeFilter.value) nextQuery.range = rangeFilter.value;
  else delete nextQuery.range;
  if (sort.value !== "createdAt" || order.value !== "desc") {
    nextQuery.sort = sort.value;
    nextQuery.order = order.value;
  } else {
    delete nextQuery.sort;
    delete nextQuery.order;
  }
  const same =
    (nextQuery.category ?? "") === queryParam("category") &&
    (nextQuery.projectId ?? "") === queryParam("projectId") &&
    (nextQuery.from ?? "") === queryParam("from") &&
    (nextQuery.to ?? "") === queryParam("to") &&
    (nextQuery.range ?? "") === queryParam("range") &&
    (nextQuery.sort ?? "") === queryParam("sort") &&
    (nextQuery.order ?? "") === queryParam("order");
  if (!same) {
    void router.replace({ query: nextQuery });
  }
});

useLiveRefresh({
  topics: ["runs", "dashboard"],
  refresh: async () => {
    await load();
  },
});
useLiveRefresh({
  topics: ["projects"],
  refresh: async () => {
    await loadProjects();
  },
});

void loadProjects();
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Impact</h1>
        <div class="subtitle">
          Individual impact items behind dashboard category totals
        </div>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="filter-bar mb-7">
      <select
        id="impact-category"
        v-model="categoryFilter"
        class="select"
        aria-label="Category"
      >
        <option value="">All categories</option>
        <option
          v-for="option in categoryOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
      <select
        id="impact-project"
        v-model="projectFilter"
        class="select"
        aria-label="Project"
      >
        <option value="">All projects</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">
          {{ project.name }}
        </option>
      </select>
    </div>

    <div v-if="loading" class="empty">Loading impact items…</div>
    <div v-else-if="items.length === 0" class="empty">
      No impact items match this filter
    </div>
    <template v-else>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <SortableTh
                column="category"
                label="Category"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <SortableTh
                column="subject"
                label="Subject"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <th>Summary</th>
              <th>Verification</th>
              <SortableTh
                column="projectName"
                label="Project"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <SortableTh
                column="agentName"
                label="Agent"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <SortableTh
                column="createdAt"
                label="Created"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <th>Run</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td>
                <span class="inline-icon-label">
                  <UiIcon :icon="impactCategorySpec(item.category).icon" :size="14" />
                  {{ impactCategoryLabel(item.category) }}
                </span>
              </td>
              <td>{{ item.subject }}</td>
              <td class="muted">{{ item.summary }}</td>
              <td>
                <VerificationBadge :verification="item.verification" />
              </td>
              <td>{{ item.projectName }}</td>
              <td>{{ item.agentName }}</td>
              <td>{{ formatWhen(item.createdAt) }}</td>
              <td>
                <RouterLink :to="{ name: 'run-detail', params: { id: item.runId } }">
                  Open run
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <TablePager
        v-model:page="page"
        :page-count="pages"
        :range-label="rangeLabel"
        :total="total"
      />
    </template>
  </div>
</template>
