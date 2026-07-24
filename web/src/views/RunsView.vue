<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";

import { listRuns } from "@/api";
import StateBadge from "@/components/StateBadge.vue";
import type { Run } from "@/types";

const runs = ref<Run[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    runs.value = await listRuns();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load runs";
  } finally {
    loading.value = false;
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
        <h1>Runs</h1>
        <div class="subtitle">Execution history</div>
      </div>
      <button class="btn btn-sm" type="button" @click="load">Refresh</button>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="runs.length === 0" class="empty">No runs recorded</div>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>ID</th>
            <th>State</th>
            <th>Trigger</th>
            <th>Project</th>
            <th>Created</th>
            <th>Finished</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in runs" :key="run.id">
            <td>
              <RouterLink :to="`/runs/${run.id}`" class="mono">{{ run.id.slice(0, 12) }}…</RouterLink>
            </td>
            <td><StateBadge :state="run.state" /></td>
            <td class="mono">{{ run.trigger }}</td>
            <td class="mono muted">{{ run.projectId.slice(0, 10) }}…</td>
            <td class="mono muted">{{ fmtTime(run.createdAt) }}</td>
            <td class="mono muted">{{ fmtTime(run.finishedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
