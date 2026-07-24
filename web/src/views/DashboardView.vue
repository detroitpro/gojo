<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";

import {
  getDashboard,
  listRuns,
  listSchedules,
  pauseInstance,
  resumeInstance,
} from "@/api";
import StateBadge from "@/components/StateBadge.vue";
import type { Run, Schedule } from "@/types";

const loading = ref(true);
const error = ref("");
const paused = ref(false);
const activeRuns = ref(0);
const runs = ref<Run[]>([]);
const schedules = ref<Schedule[]>([]);

const runningCount = computed(
  () =>
    runs.value.filter((r) =>
      ["Running", "Preparing", "Validating", "Integrating", "Reporting"].includes(r.state),
    ).length,
);

const queuedCount = computed(
  () => runs.value.filter((r) => ["Queued", "Scheduled"].includes(r.state)).length,
);

const failedCount = computed(
  () =>
    runs.value.filter((r) =>
      ["Failed", "TimedOut", "InfrastructureFailure", "Conflict", "Abandoned"].includes(r.state),
    ).length,
);

const recentRuns = computed(() => runs.value.slice(0, 8));

const disabledSchedules = computed(() => schedules.value.filter((s) => !s.enabled));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [dashboard, runList, scheduleList] = await Promise.all([
      getDashboard(),
      listRuns(),
      listSchedules(),
    ]);
    paused.value = dashboard.paused;
    activeRuns.value = dashboard.activeRuns;
    runs.value = runList;
    schedules.value = scheduleList;
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

onMounted(load);
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
          <div class="label">Running</div>
          <div class="value">{{ runningCount }}</div>
        </div>
        <div class="stat">
          <div class="label">Queued</div>
          <div class="value">{{ queuedCount }}</div>
        </div>
        <div class="stat">
          <div class="label">Failed</div>
          <div class="value bad">{{ failedCount }}</div>
        </div>
        <div class="stat">
          <div class="label">Active (API)</div>
          <div class="value ok">{{ activeRuns }}</div>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">Recent runs</div>
        <div v-if="recentRuns.length === 0" class="empty">No runs yet</div>
        <div v-else class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>ID</th>
                <th>State</th>
                <th>Trigger</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="run in recentRuns" :key="run.id">
                <td>
                  <RouterLink :to="`/runs/${run.id}`" class="mono">{{ run.id.slice(0, 10) }}…</RouterLink>
                </td>
                <td><StateBadge :state="run.state" /></td>
                <td class="mono">{{ run.trigger }}</td>
                <td class="mono muted">{{ fmtTime(run.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">Disabled schedules ({{ disabledSchedules.length }})</div>
        <div v-if="disabledSchedules.length === 0" class="panel-body muted">All schedules enabled</div>
        <div v-else class="table-wrap">
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
      </section>
    </template>
  </div>
</template>
