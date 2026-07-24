<script setup lang="ts">
import { onMounted, ref } from "vue";

import { disableSchedule, enableSchedule, listProjects, listSchedules } from "@/api";
import TablePager from "@/components/TablePager.vue";
import { useServerTable } from "@/composables/useServerTable";
import { MAX_PAGE_LIMIT } from "@/lib/pagination";
import type { Project, Schedule } from "@/types";

const projects = ref<Project[]>([]);
const projectFilter = ref("");
const enabledFilter = ref<"all" | "enabled" | "disabled">("all");
const query = ref("");
const busyId = ref<string | null>(null);

const {
  page,
  pages,
  items: schedules,
  total,
  loading,
  error,
  rangeLabel,
  reload,
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
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Update failed";
  } finally {
    busyId.value = null;
  }
}

function fmtTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

onMounted(() => {
  void loadProjects();
  void load();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Schedules</h1>
        <div class="subtitle">Cron triggers and enablement</div>
      </div>
      <button class="btn btn-sm" type="button" :disabled="loading" @click="reload()">Refresh</button>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="inline-form mb-7 task-filters">
      <div class="field">
        <label for="sched-project-filter">Project</label>
        <select id="sched-project-filter" v-model="projectFilter">
          <option value="">All projects</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="sched-enabled-filter">Enabled</label>
        <select id="sched-enabled-filter" v-model="enabledFilter">
          <option value="all">All</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>
      <div class="field flex-2">
        <label for="sched-search">Search</label>
        <input
          id="sched-search"
          v-model="query"
          class="input"
          type="search"
          placeholder="Name, task, cron…"
        />
      </div>
      <div class="field task-filter-count">
        <label>&nbsp;</label>
        <span class="muted">{{ total }} schedule{{ total === 1 ? "" : "s" }}</span>
      </div>
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
              <th>Cron</th>
              <th>TZ</th>
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
              <td class="mono">{{ schedule.cronExpr }}</td>
              <td class="mono muted">{{ schedule.timezone }}</td>
              <td>
                <span v-if="schedule.enabled" class="badge badge-success">enabled</span>
                <span v-else class="badge badge-neutral">disabled</span>
              </td>
              <td class="mono muted">{{ fmtTime(schedule.nextRunAt) }}</td>
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
