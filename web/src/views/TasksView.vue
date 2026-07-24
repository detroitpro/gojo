<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { listProjects, listTasks, runTask } from "@/api";
import type { Project, Task } from "@/types";

const router = useRouter();

const projects = ref<Project[]>([]);
const tasks = ref<Task[]>([]);
const projectId = ref("");
const loading = ref(true);
const error = ref("");
const busyId = ref<string | null>(null);

async function loadProjects() {
  projects.value = await listProjects();
  if (!projectId.value && projects.value[0]) {
    projectId.value = projects.value[0].id;
  }
}

async function loadTasks() {
  if (!projectId.value) {
    tasks.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    tasks.value = await listTasks(projectId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load tasks";
  } finally {
    loading.value = false;
  }
}

async function runNow(id: string) {
  busyId.value = id;
  error.value = "";
  try {
    const run = await runTask(id);
    await router.push(`/runs/${run.id}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to start run";
  } finally {
    busyId.value = null;
  }
}

watch(projectId, () => {
  void loadTasks();
});

onMounted(async () => {
  try {
    await loadProjects();
    await loadTasks();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load";
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Tasks</h1>
        <div class="subtitle">Manifest-synced and API-created tasks</div>
      </div>
      <button class="btn btn-sm" type="button" @click="loadTasks">Refresh</button>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="inline-form mb-7">
      <div class="field">
        <label for="project">Project</label>
        <select id="project" v-model="projectId">
          <option disabled value="">Select a project…</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="!projectId" class="empty">Add a project first</div>
    <div v-else-if="tasks.length === 0" class="empty">No tasks for this project</div>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Enabled</th>
            <th>Agent</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.id">
            <td>
              <div>{{ task.name }}</div>
              <div v-if="task.description" class="muted text-sm">
                {{ task.description }}
              </div>
            </td>
            <td>{{ task.enabled ? "yes" : "no" }}</td>
            <td class="mono muted">{{ task.agentProfileId ?? "—" }}</td>
            <td class="mono muted">{{ new Date(task.createdAt).toLocaleString() }}</td>
            <td>
              <button
                class="btn btn-sm btn-primary"
                type="button"
                :disabled="busyId === task.id || !task.enabled"
                @click="runNow(task.id)"
              >
                Run now
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
