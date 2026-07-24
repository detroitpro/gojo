<script setup lang="ts">
import { onMounted, ref } from "vue";

import { disableSchedule, enableSchedule, listSchedules } from "@/api";
import type { Schedule } from "@/types";

const schedules = ref<Schedule[]>([]);
const loading = ref(true);
const error = ref("");
const busyId = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    schedules.value = await listSchedules();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load schedules";
  } finally {
    loading.value = false;
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

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Schedules</h1>
        <div class="subtitle">Cron triggers and enablement</div>
      </div>
      <button class="btn btn-sm" type="button" @click="load">Refresh</button>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="schedules.length === 0" class="empty">No schedules configured</div>
    <div v-else class="table-wrap">
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
  </div>
</template>
