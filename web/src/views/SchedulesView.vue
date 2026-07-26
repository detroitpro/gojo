<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import {
  disableSchedule,
  enableSchedule,
  listProjects,
  listSchedules,
  listSchedulesUpcoming,
} from "@/api";
import SchedulesTimelineChart from "@/components/SchedulesTimelineChart.vue";
import TablePager from "@/components/TablePager.vue";
import { useServerTable } from "@/composables/useServerTable";
import { MAX_PAGE_LIMIT } from "@/lib/pagination";
import {
  formatAbsoluteInZone,
  formatRelativeNextRun,
  formatTimezoneLabel,
} from "@/lib/schedule-format";
import type { Project, Schedule, SchedulesUpcomingResult } from "@/types";

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

const projects = ref<Project[]>([]);
const projectFilter = ref(queryParam("projectId"));
const enabledFilter = ref<"all" | "enabled" | "disabled">("enabled");
const query = ref("");
const busyId = ref<string | null>(null);
const horizonHours = ref(168);
const upcoming = ref<SchedulesUpcomingResult | null>(null);
const upcomingLoading = ref(false);

const {
  page,
  pages,
  items: schedules,
  total,
  loading,
  error,
  rangeLabel,
  load,
} = useServerTable({
  watchSources: [projectFilter, enabledFilter, query],
  fetchPage: ({ limit, offset }) =>
    listSchedules({
      limit,
      offset,
      projectId: projectFilter.value || undefined,
      enabled: enabledFilter.value,
      q: query.value || undefined,
    }),
});

async function loadProjects() {
  const result = await listProjects({ limit: MAX_PAGE_LIMIT, offset: 0 });
  projects.value = result.items;
}

async function loadUpcoming() {
  upcomingLoading.value = true;
  try {
    upcoming.value = await listSchedulesUpcoming({
      horizonHours: horizonHours.value,
      projectId: projectFilter.value || undefined,
      enabled: enabledFilter.value,
      q: query.value || undefined,
    });
  } catch {
    upcoming.value = null;
  } finally {
    upcomingLoading.value = false;
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
  () => route.query.projectId,
  (projectId) => {
    const next = typeof projectId === "string" ? projectId : "";
    if (next !== projectFilter.value) {
      projectFilter.value = next;
    }
  },
);

watch(projectFilter, (value) => {
  const current = queryParam("projectId");
  if (value === current) {
    return;
  }
  const nextQuery = { ...route.query } as Record<string, string>;
  if (value) {
    nextQuery.projectId = value;
  } else {
    delete nextQuery.projectId;
  }
  void router.replace({ query: nextQuery });
});

onMounted(() => {
  void loadProjects();
  void load();
  void loadUpcoming();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Schedules</h1>
        <div class="subtitle">Cron triggers and enablement</div>
      </div>
    </header>

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
            placeholder="Name, task, cron…"
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
          v-else-if="upcoming"
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
        placeholder="Name, task, cron…"
        aria-label="Search"
      />
    </div>

    <div v-if="loading && schedules.length === 0" class="empty">Loading…</div>
    <div v-else-if="total === 0" class="empty">
      {{
        query || projectFilter || enabledFilter !== "all"
          ? "No schedules match these filters"
          : "No schedules configured"
      }}
    </div>
    <template v-else>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Task</th>
              <th>Project</th>
              <th>Schedule</th>
              <th>Status</th>
              <th>Next</th>
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
                <div>{{ schedule.taskName || "—" }}</div>
                <div class="mono muted text-sm">{{ schedule.taskId.slice(0, 10) }}…</div>
              </td>
              <td>{{ schedule.projectName || "—" }}</td>
              <td>
                <div>{{ cronPrimary(schedule) }}</div>
                <div class="mono muted text-sm">
                  {{ schedule.cronExpr }} · {{ formatTimezoneLabel(schedule.timezone) }}
                </div>
              </td>
              <td>
                <span v-if="schedule.enabled" class="badge badge-success">enabled</span>
                <span v-else class="badge badge-neutral">disabled</span>
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
                <button
                  class="btn btn-sm"
                  type="button"
                  :disabled="busyId === schedule.id"
                  @click="toggle(schedule)"
                >
                  {{ schedule.enabled ? "Disable" : "Enable" }}
                </button>
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
