<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";

import { getDashboard, listRuns, listSchedules, pauseInstance, resumeInstance } from "@/api";
import StateBadge from "@/components/StateBadge.vue";
import TablePager from "@/components/TablePager.vue";
import { useServerTable } from "@/composables/useServerTable";

const loading = ref(true);
const error = ref("");
const paused = ref(false);
const activeRuns = ref(0);
const projectCount = ref(0);
const taskCount = ref(0);
const scheduleCount = ref(0);
const runsTotal = ref(0);

const {
  page: recentPage,
  pages: recentPages,
  items: recentRuns,
  total: recentTotal,
  rangeLabel: recentRange,
  load: loadRecent,
} = useServerTable({
  pageSize: 8,
  fetchPage: ({ limit, offset }) => listRuns({ limit, offset }),
});

const {
  page: disabledPage,
  pages: disabledPages,
  items: disabledSchedules,
  total: disabledTotal,
  rangeLabel: disabledRange,
  load: loadDisabled,
} = useServerTable({
  pageSize: 25,
  fetchPage: ({ limit, offset }) =>
    listSchedules({
      limit,
      offset,
      enabled: false,
    }),
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const dashboard = await getDashboard();
    paused.value = dashboard.paused;
    activeRuns.value = dashboard.activeRuns;
    projectCount.value = dashboard.projects;
    taskCount.value = dashboard.tasks;
    scheduleCount.value = dashboard.schedules;
    runsTotal.value = dashboard.runs;
    await Promise.all([loadRecent(), loadDisabled()]);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load dashboard";
  } finally {
    loading.value = false;
  }
}

async function togglePause() {
  if (paused.value) {
    await resumeInstance();
  } else {
    await pauseInstance();
  }
  await load();
}

function fmtTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Dashboard</h1>
        <div class="subtitle">Scheduler ops overview</div>
      </div>
      <div class="toolbar">
        <span v-if="paused" class="badge badge-warn">Paused</span>
        <button class="btn" type="button" @click="togglePause">
          {{ paused ? "Resume scheduler" : "Pause scheduler" }}
        </button>
        <button class="btn btn-sm" type="button" @click="load">Refresh</button>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="loading" class="empty">Loading…</div>

    <template v-else>
      <div class="stats-row">
        <div class="stat">
          <div class="label">Projects</div>
          <div class="value">{{ projectCount }}</div>
        </div>
        <div class="stat">
          <div class="label">Tasks</div>
          <div class="value">{{ taskCount }}</div>
        </div>
        <div class="stat">
          <div class="label">Schedules</div>
          <div class="value">{{ scheduleCount }}</div>
        </div>
        <div class="stat">
          <div class="label">Runs</div>
          <div class="value">{{ runsTotal }}</div>
        </div>
        <div class="stat">
          <div class="label">Active</div>
          <div class="value ok">{{ activeRuns }}</div>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">Recent runs</div>
        <div v-if="recentTotal === 0" class="empty">No runs yet</div>
        <template v-else>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Project</th>
                  <th>State</th>
                  <th>Trigger</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="run in recentRuns" :key="run.id">
                  <td>
                    <RouterLink :to="`/runs/${run.id}`" class="entity-name">
                      {{ run.taskName || "Unknown task" }}
                    </RouterLink>
                    <div class="mono muted text-sm">{{ run.id.slice(0, 10) }}…</div>
                  </td>
                  <td>{{ run.projectName || "—" }}</td>
                  <td><StateBadge :state="run.state" /></td>
                  <td class="mono">{{ run.trigger }}</td>
                  <td class="mono muted">{{ fmtTime(run.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <TablePager
            v-model:page="recentPage"
            :page-count="recentPages"
            :range-label="recentRange"
            :total="recentTotal"
          />
        </template>
      </section>

      <section class="panel">
        <div class="panel-header">Disabled schedules</div>
        <div v-if="disabledTotal === 0" class="panel-body muted">All schedules enabled</div>
        <template v-else>
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Cron</th>
                  <th>Failures</th>
                  <th>Last run</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="schedule in disabledSchedules" :key="schedule.id">
                  <td>{{ schedule.name }}</td>
                  <td class="mono">{{ schedule.cronExpr }}</td>
                  <td class="mono">{{ schedule.consecutiveFailures }}</td>
                  <td class="mono muted">{{ fmtTime(schedule.lastRunAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <TablePager
            v-model:page="disabledPage"
            :page-count="disabledPages"
            :range-label="disabledRange"
            :total="disabledTotal"
          />
        </template>
      </section>
    </template>
  </div>
</template>
