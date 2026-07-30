<script setup lang="ts">
import { ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { listIntegrations, listProjects } from "@/api";
import AppButton from "@/components/AppButton.vue";
import IntegrationStatusBadge from "@/components/status/IntegrationStatusBadge.vue";
import SortableTh from "@/components/SortableTh.vue";
import TablePager from "@/components/TablePager.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useServerTable } from "@/composables/useServerTable";
import { MAX_PAGE_LIMIT, type SortOrder } from "@/lib/pagination";
import { GitCommitHorizontal, GitMerge, GitPullRequest } from "lucide-vue-next";
import type { IntegrationListStatus, Project } from "@/types";

const INTEGRATION_SORT_ALLOWED = [
  "openedAt",
  "mergedAt",
  "createdAt",
  "projectName",
  "agentName",
  "prNumber",
] as const;

const STATUSES: { value: IntegrationListStatus; label: string; icon: typeof GitPullRequest }[] = [
  { value: "open", label: "Open", icon: GitPullRequest },
  { value: "merged", label: "Merged", icon: GitMerge },
  { value: "committed", label: "Commits", icon: GitCommitHorizontal },
];

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

function initialStatus(): IntegrationListStatus {
  const value = queryParam("status");
  return value === "merged" || value === "committed" ? value : "open";
}

function initialSort(): string {
  const value = queryParam("sort");
  if ((INTEGRATION_SORT_ALLOWED as readonly string[]).includes(value)) {
    return value;
  }
  const status = initialStatus();
  if (status === "merged") return "mergedAt";
  if (status === "committed") return "createdAt";
  return "openedAt";
}

function initialOrder(): SortOrder {
  const value = queryParam("order");
  return value === "asc" || value === "desc" ? value : "desc";
}

const projects = ref<Project[]>([]);
const statusFilter = ref<IntegrationListStatus>(initialStatus());
const projectFilter = ref(queryParam("projectId"));
const fromFilter = ref(queryParam("from"));
const toFilter = ref(queryParam("to"));

const {
  page,
  pages,
  items: integrations,
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
  watchSources: [statusFilter, projectFilter, fromFilter, toFilter],
  fetchPage: ({ limit, offset, sort: sortBy, order: sortOrder }) =>
    listIntegrations({
      limit,
      offset,
      sort: sortBy,
      order: sortOrder,
      status: statusFilter.value,
      projectId: projectFilter.value || undefined,
      from: fromFilter.value || undefined,
      to: toFilter.value || undefined,
    }),
});

async function loadProjects() {
  const result = await listProjects({ limit: MAX_PAGE_LIMIT, offset: 0 });
  projects.value = result.items;
}

function shortSha(sha: string | null): string {
  if (!sha) return "—";
  return sha.length > 12 ? `${sha.slice(0, 7)}…` : sha;
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

watch(
  () =>
    [route.query.status, route.query.projectId, route.query.from, route.query.to] as const,
  ([status, projectId, from, to]) => {
    const nextStatus: IntegrationListStatus =
      status === "merged" || status === "committed" ? status : "open";
    const nextProject = typeof projectId === "string" ? projectId : "";
    const nextFrom = typeof from === "string" ? from : "";
    const nextTo = typeof to === "string" ? to : "";
    if (statusFilter.value !== nextStatus) statusFilter.value = nextStatus;
    if (projectFilter.value !== nextProject) projectFilter.value = nextProject;
    if (fromFilter.value !== nextFrom) fromFilter.value = nextFrom;
    if (toFilter.value !== nextTo) toFilter.value = nextTo;
  },
);

watch([statusFilter, projectFilter, fromFilter, toFilter, sort, order], () => {
  const nextQuery = { ...route.query } as Record<string, string>;
  nextQuery.status = statusFilter.value;
  if (projectFilter.value) nextQuery.projectId = projectFilter.value;
  else delete nextQuery.projectId;
  if (fromFilter.value) nextQuery.from = fromFilter.value;
  else delete nextQuery.from;
  if (toFilter.value) nextQuery.to = toFilter.value;
  else delete nextQuery.to;
  const defaultSort =
    statusFilter.value === "merged"
      ? "mergedAt"
      : statusFilter.value === "committed"
        ? "createdAt"
        : "openedAt";
  if (sort.value !== defaultSort || order.value !== "desc") {
    nextQuery.sort = sort.value;
    nextQuery.order = order.value;
  } else {
    delete nextQuery.sort;
    delete nextQuery.order;
  }
  const same =
    (nextQuery.status ?? "") === queryParam("status") &&
    (nextQuery.projectId ?? "") === queryParam("projectId") &&
    (nextQuery.from ?? "") === queryParam("from") &&
    (nextQuery.to ?? "") === queryParam("to") &&
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
        <h1>Integrations</h1>
        <div class="subtitle">
          Open PRs, merges, and commits produced by automation runs
        </div>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="filter-bar mb-7">
      <div class="btn-row">
        <AppButton
          v-for="tab in STATUSES"
          :key="tab.value"
          size="sm"
          variant="ghost"
          :icon="tab.icon"
          :selected="statusFilter === tab.value"
          @click="statusFilter = tab.value"
        >
          {{ tab.label }}
        </AppButton>
      </div>
      <select
        id="integrations-project"
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

    <div v-if="loading" class="empty">Loading integrations…</div>
    <div v-else-if="integrations.length === 0" class="empty">
      No {{ statusFilter }} integrations in this filter
    </div>
    <template v-else>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
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
              <th>{{ statusFilter === "committed" ? "Commit" : "PR" }}</th>
              <th>Status</th>
              <SortableTh
                v-if="statusFilter !== 'committed'"
                column="openedAt"
                label="Opened"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <SortableTh
                v-if="statusFilter === 'merged'"
                column="mergedAt"
                label="Merged"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <SortableTh
                v-if="statusFilter === 'committed'"
                column="createdAt"
                label="Run created"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <th>Run</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in integrations" :key="row.runId">
              <td>{{ row.projectName ?? row.projectId }}</td>
              <td>{{ row.agentName ?? row.agentId }}</td>
              <td>
                <template v-if="statusFilter === 'committed'">
                  <span class="mono">{{ shortSha(row.commitSha) }}</span>
                </template>
                <template v-else-if="row.prUrl">
                  <a :href="row.prUrl" target="_blank" rel="noopener noreferrer">
                    #{{ row.prNumber ?? "?" }}
                  </a>
                </template>
                <template v-else>#{{ row.prNumber ?? "—" }}</template>
              </td>
              <td>
                <IntegrationStatusBadge :status="row.status" />
              </td>
              <td v-if="statusFilter !== 'committed'">{{ formatWhen(row.openedAt) }}</td>
              <td v-if="statusFilter === 'merged'">{{ formatWhen(row.mergedAt) }}</td>
              <td v-if="statusFilter === 'committed'">{{ formatWhen(row.runCreatedAt) }}</td>
              <td>
                <RouterLink :to="{ name: 'run-detail', params: { id: row.runId } }">
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
