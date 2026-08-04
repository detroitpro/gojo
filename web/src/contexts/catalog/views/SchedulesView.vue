<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import {
  disableSchedule,
  enableSchedule,
  listProjects,
  listSchedules,
  useCatalogStore,
} from "@/contexts/catalog/contract";
import { listSchedulesUpcoming } from "@/contexts/scheduling/contract";
import AppButton from "@/ui/AppButton.vue";
import PageHeader from "@/ui/PageHeader.vue";
import EnabledBadge from "@/ui/status/EnabledBadge.vue";
import SchedulesTimelineChart from "@/ui/SchedulesTimelineChart.vue";
import SortableTh from "@/ui/SortableTh.vue";
import TablePager from "@/ui/TablePager.vue";
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import { useServerTable } from "@/platform/useServerTable";
import { useSoftLoading } from "@/platform/useSoftLoading";
import { MAX_PAGE_LIMIT, type SortOrder } from "@/kernel/pagination";
import {
  formatAbsoluteInZone,
  formatRelativeNextRun,
  formatTimezoneLabel,
} from "@/kernel/schedule-format";
import { Power } from "lucide-vue-next";
import type { Project, Schedule } from "@/contexts/catalog/types";
import type { SchedulesUpcomingResult } from "@/contexts/scheduling/types";

const SCHEDULE_SORT_ALLOWED = [
  "name",
  "projectName",
  "cronExpr",
  "nextRunAt",
  "lastRunAt",
  "enabled",
  "createdAt",
] as const;

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

function initialSort(): string {
  const value = queryParam("sort");
  return (SCHEDULE_SORT_ALLOWED as readonly string[]).includes(value) ? value : "createdAt";
}

function initialOrder(): SortOrder {
  const value = queryParam("order");
  return value === "asc" || value === "desc" ? value : "asc";
}

function initialEnabled(): "all" | "enabled" | "disabled" {
  const value = queryParam("enabled");
  return value === "all" || value === "disabled" ? value : "enabled";
}

const projects = ref<Project[]>([]);
const projectFilter = ref(queryParam("projectId"));
const agentFilter = ref(queryParam("agentId"));
const enabledFilter = ref<"all" | "enabled" | "disabled">(initialEnabled());
const query = ref(queryParam("q"));
const busyId = ref<string | null>(null);
const horizonHours = ref(168);
const upcoming = ref<SchedulesUpcomingResult | null>(null);
const {
  loading: upcomingLoading,
  begin: beginUpcoming,
  end: endUpcoming,
} = useSoftLoading(false);

const {
  page,
  pages,
  items: schedules,
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
  watchSources: [projectFilter, agentFilter, enabledFilter, query],
  fetchPage: ({ limit, offset, sort: sortBy, order: sortOrder }) =>
    listSchedules({
      limit,
      offset,
      sort: sortBy,
      order: sortOrder,
      projectId: projectFilter.value || undefined,
      agentId: agentFilter.value || undefined,
      enabled: enabledFilter.value,
      q: query.value || undefined,
    }),
});

async function loadProjects() {
  const result = await listProjects({ limit: MAX_PAGE_LIMIT, offset: 0 });
  projects.value = result.items;
}

async function loadUpcoming() {
  const initial = beginUpcoming();
  try {
    upcoming.value = await listSchedulesUpcoming({
      horizonHours: horizonHours.value,
      projectId: projectFilter.value || undefined,
      enabled: enabledFilter.value,
      q: query.value || undefined,
    });
  } catch {
    if (initial) upcoming.value = null;
  } finally {
    endUpcoming(initial);
  }
}

async function toggle(schedule: Schedule) {
  busyId.value = schedule.id;
  error.value = "";
  try {
    if (schedule.enabled) {
      await disableSchedule(schedule.id);
    } else {
      await enableSchedule(schedule.id);
    }
    await load();
    await loadUpcoming();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Update failed";
  } finally {
    busyId.value = null;
  }
}

function cronPrimary(schedule: Schedule): string {
  return schedule.cronDescription?.trim() || schedule.cronExpr;
}

watch([projectFilter, enabledFilter, query, horizonHours], () => {
  void loadUpcoming();
});

watch(
  () =>
    [route.query.projectId, route.query.agentId, route.query.q, route.query.enabled] as const,
  ([projectId, agentId, q, enabled]) => {
    const nextProject = typeof projectId === "string" ? projectId : "";
    const nextAgent = typeof agentId === "string" ? agentId : "";
    const nextQ = typeof q === "string" ? q : "";
    const nextEnabled =
      enabled === "all" || enabled === "disabled" || enabled === "enabled"
        ? enabled
        : "enabled";
    if (projectFilter.value !== nextProject) {
      projectFilter.value = nextProject;
    }
    if (agentFilter.value !== nextAgent) {
      agentFilter.value = nextAgent;
    }
    if (query.value !== nextQ) {
      query.value = nextQ;
    }
    if (enabledFilter.value !== nextEnabled) {
      enabledFilter.value = nextEnabled;
    }
  },
);

watch([projectFilter, agentFilter, enabledFilter, query, sort, order], () => {
  const nextQuery = { ...route.query } as Record<string, string>;
  if (projectFilter.value) {
    nextQuery.projectId = projectFilter.value;
  } else {
    delete nextQuery.projectId;
  }
  if (agentFilter.value) {
    nextQuery.agentId = agentFilter.value;
  } else {
    delete nextQuery.agentId;
  }
  if (query.value) {
    nextQuery.q = query.value;
  } else {
    delete nextQuery.q;
  }
  if (enabledFilter.value !== "enabled") {
    nextQuery.enabled = enabledFilter.value;
  } else {
    delete nextQuery.enabled;
  }
  if (sort.value !== "createdAt" || order.value !== "asc") {
    nextQuery.sort = sort.value;
    nextQuery.order = order.value;
  } else {
    delete nextQuery.sort;
    delete nextQuery.order;
  }
  const same =
    (nextQuery.projectId ?? "") === queryParam("projectId") &&
    (nextQuery.agentId ?? "") === queryParam("agentId") &&
    (nextQuery.q ?? "") === queryParam("q") &&
    (nextQuery.enabled ?? "") === queryParam("enabled") &&
    (nextQuery.sort ?? "") === queryParam("sort") &&
    (nextQuery.order ?? "") === queryParam("order");
  if (!same) {
    void router.replace({ query: nextQuery });
  }
});

const catalogStore = useCatalogStore();
// One refresher: a single catalog invalidate must not fan out into two parallel loaders.
bindStoreRefresh(catalogStore, async () => {
  await Promise.all([load(), loadProjects(), loadUpcoming()]);
});
</script>

<template>
  <div>
    <PageHeader
      title="Schedules"
      subtitle="Cron is a suggested start — the run queue admits under the global concurrency cap"
    />

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <section class="panel mb-7">
      <div class="panel-header schedules-panel-header">
        <span>Future runs</span>
        <div class="filter-bar schedules-toolbar">
          <select
            id="sched-chart-project"
            v-model="projectFilter"
            class="select"
            aria-label="Project"
          >
            <option value="">All projects</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
          <select
            id="sched-chart-enabled"
            v-model="enabledFilter"
            class="select"
            aria-label="Enabled"
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
            <option value="all">All</option>
          </select>
          <input
            id="sched-chart-search"
            v-model="query"
            class="input filter-bar-search"
            type="search"
            placeholder="Name, agent, cron…"
            aria-label="Search"
          />
          <select
            id="sched-horizon"
            v-model.number="horizonHours"
            class="select"
            aria-label="Horizon"
          >
            <option :value="24">24 hours</option>
            <option :value="168">7 days</option>
            <option :value="720">30 days</option>
          </select>
        </div>
      </div>
      <div class="panel-body">
        <div v-if="upcomingLoading && !upcoming" class="muted">Loading timeline…</div>
        <SchedulesTimelineChart
          v-else-if="upcoming?.schedules"
          :schedules="upcoming.schedules"
          :from="upcoming.from"
          :to="upcoming.to"
        />
        <div v-else class="muted">Could not load upcoming fires.</div>
        <div class="muted text-sm mt-2">
          Drag to pan · scroll to zoom · colors match each schedule
        </div>
      </div>
    </section>

    <div class="filter-bar mb-7">
      <select
        id="sched-table-project"
        v-model="projectFilter"
        class="select"
        aria-label="Project"
      >
        <option value="">All projects</option>
        <option v-for="project in projects" :key="`table-${project.id}`" :value="project.id">
          {{ project.name }}
        </option>
      </select>
      <select
        id="sched-table-enabled"
        v-model="enabledFilter"
        class="select"
        aria-label="Enabled"
      >
        <option value="enabled">Enabled</option>
        <option value="disabled">Disabled</option>
        <option value="all">All</option>
      </select>
      <input
        id="sched-table-search"
        v-model="query"
        class="input filter-bar-search"
        type="search"
        placeholder="Name, agent, cron…"
        aria-label="Search"
      />
    </div>

    <div v-if="loading && schedules.length === 0" class="empty">Loading schedules…</div>
    <div v-else-if="total === 0" class="empty">
      {{
        query || projectFilter || agentFilter || enabledFilter !== "all"
          ? "No schedules match these filters"
          : "No schedules yet — define them in gojo.yaml and Sync the project"
      }}
    </div>
    <template v-else>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <SortableTh column="name" label="Name" :sort="sort" :order="order" @sort="setSort" />
              <th>Agent</th>
              <SortableTh
                column="projectName"
                label="Project"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <SortableTh
                column="cronExpr"
                label="Schedule"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <th>Overlap</th>
              <SortableTh
                column="enabled"
                label="Status"
                :sort="sort"
                :order="order"
                default-order="desc"
                @sort="setSort"
              />
              <SortableTh
                column="nextRunAt"
                label="Next"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <th>Failures</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="schedule in schedules" :key="schedule.id">
              <td>
                <div class="entity-name">{{ schedule.name }}</div>
                <div class="mono muted text-sm">{{ schedule.id.slice(0, 10) }}…</div>
              </td>
              <td>
                <div>{{ schedule.agentName || "—" }}</div>
                <div class="mono muted text-sm">{{ schedule.agentId.slice(0, 10) }}…</div>
              </td>
              <td>{{ schedule.projectName || "—" }}</td>
              <td>
                <div>{{ cronPrimary(schedule) }}</div>
                <div class="mono muted text-sm">
                  {{ schedule.cronExpr }} · {{ formatTimezoneLabel(schedule.timezone) }}
                </div>
              </td>
              <td class="mono muted text-sm">{{ schedule.overlapPolicy || "skip" }}</td>
              <td>
                <EnabledBadge :enabled="schedule.enabled" />
              </td>
              <td>
                <template v-if="schedule.enabled && schedule.nextRunAt">
                  <div>
                    {{ formatRelativeNextRun(schedule.nextRunAt, Date.now(), schedule.timezone) }}
                  </div>
                  <div class="mono muted text-sm">
                    {{ formatAbsoluteInZone(schedule.nextRunAt, schedule.timezone) }}
                  </div>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td class="mono">{{ schedule.consecutiveFailures }}</td>
              <td>
                <AppButton
                  size="sm"
                  :icon="Power"
                  :loading="busyId === schedule.id"
                  loading-label="Working…"
                  @click="toggle(schedule)"
                >
                  {{ schedule.enabled ? "Disable" : "Enable" }}
                </AppButton>
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
