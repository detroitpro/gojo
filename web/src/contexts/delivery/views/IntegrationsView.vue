<script setup lang="ts">
import { ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { listIntegrations, useDeliveryStore } from "@/contexts/delivery/contract";
import { listProjects } from "@/contexts/catalog/contract";
import AppButton from "@/ui/AppButton.vue";
import PageHeader from "@/ui/PageHeader.vue";
import IntegrationStatusBadge from "@/ui/status/IntegrationStatusBadge.vue";
import SortableTh from "@/ui/SortableTh.vue";
import TablePager from "@/ui/TablePager.vue";
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import { useServerTable } from "@/platform/useServerTable";
import { MAX_PAGE_LIMIT, type SortOrder } from "@/kernel/pagination";
import {
  defaultIntegrationSort,
  type IntegrationListStatus,
} from "@gojo/contracts/types";
import { GitCommitHorizontal, GitMerge, GitPullRequest, Layers } from "lucide-vue-next";
import type { Project } from "@/contexts/catalog/types";

const INTEGRATION_SORT_ALLOWED = [
  "activityAt",
  "openedAt",
  "mergedAt",
  "createdAt",
  "projectName",
  "agentName",
  "prNumber",
] as const;

const STATUSES: { value: IntegrationListStatus; label: string; icon: typeof GitPullRequest }[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "open", label: "Open", icon: GitPullRequest },
  { value: "merged", label: "Merged", icon: GitMerge },
  { value: "committed", label: "Commits", icon: GitCommitHorizontal },
];

type StatusCounts = Record<IntegrationListStatus, number | null>;

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

function parseStatus(value: string): IntegrationListStatus {
  if (value === "open" || value === "merged" || value === "committed" || value === "all") {
    return value;
  }
  return "all";
}

function initialStatus(): IntegrationListStatus {
  return parseStatus(queryParam("status"));
}

function initialSort(): string {
  const value = queryParam("sort");
  if ((INTEGRATION_SORT_ALLOWED as readonly string[]).includes(value)) {
    return value;
  }
  return defaultIntegrationSort(initialStatus());
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
const statusCounts = ref<StatusCounts>({
  all: null,
  open: null,
  merged: null,
  committed: null,
});

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

async function loadCounts() {
  const base = {
    limit: 1,
    offset: 0,
    projectId: projectFilter.value || undefined,
    from: fromFilter.value || undefined,
    to: toFilter.value || undefined,
  };
  const [allPage, openPage, mergedPage, committedPage] = await Promise.all([
    listIntegrations({ ...base, status: "all" }).catch(() => null),
    listIntegrations({ ...base, status: "open" }).catch(() => null),
    listIntegrations({ ...base, status: "merged" }).catch(() => null),
    listIntegrations({ ...base, status: "committed" }).catch(() => null),
  ]);
  statusCounts.value = {
    all: allPage?.total ?? null,
    open: openPage?.total ?? null,
    merged: mergedPage?.total ?? null,
    committed: committedPage?.total ?? null,
  };
}

function tabLabel(status: IntegrationListStatus, label: string): string {
  const count = statusCounts.value[status];
  return count == null ? label : `${label} (${count})`;
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

function emptyLabel(status: IntegrationListStatus): string {
  if (status === "all") return "No open or merged integrations in this filter";
  if (status === "committed") return "No commit-only integrations in this filter";
  return `No ${status} integrations in this filter`;
}

watch(
  () =>
    [route.query.status, route.query.projectId, route.query.from, route.query.to] as const,
  ([status, projectId, from, to]) => {
    const nextStatus = parseStatus(typeof status === "string" ? status : "");
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
  if (statusFilter.value === "all") delete nextQuery.status;
  else nextQuery.status = statusFilter.value;
  if (projectFilter.value) nextQuery.projectId = projectFilter.value;
  else delete nextQuery.projectId;
  if (fromFilter.value) nextQuery.from = fromFilter.value;
  else delete nextQuery.from;
  if (toFilter.value) nextQuery.to = toFilter.value;
  else delete nextQuery.to;
  const defaultSort = defaultIntegrationSort(statusFilter.value);
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

watch([projectFilter, fromFilter, toFilter], () => {
  void loadCounts();
});

const deliveryStore = useDeliveryStore();
bindStoreRefresh(deliveryStore, load);
bindStoreRefresh(deliveryStore, loadProjects);
bindStoreRefresh(deliveryStore, loadCounts);
</script>

<template>
  <div>
    <PageHeader
      title="Integrations"
      subtitle="Recent open and merged PRs from automation runs"
    />

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
          {{ tabLabel(tab.value, tab.label) }}
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
      {{ emptyLabel(statusFilter) }}
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
                v-if="statusFilter === 'merged' || statusFilter === 'all'"
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
              <td v-if="statusFilter === 'merged' || statusFilter === 'all'">
                {{ formatWhen(row.mergedAt) }}
              </td>
              <td v-if="statusFilter === 'committed'">{{ formatWhen(row.runCreatedAt) }}</td>
              <td>
                <RouterLink :to="{ name: 'run-detail', params: { id: row.runId } }">
                  Open run
                </RouterLink>
                <span class="muted"> · </span>
                <RouterLink :to="{ name: 'approvals' }">Approvals</RouterLink>
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
