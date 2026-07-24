<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { listProjects, listTasks, runTask } from "@/api";
import type { Project, Task } from "@/types";

const router = useRouter();

const PAGE_SIZE = 25;

const projects = ref<Project[]>([]);
const tasks = ref<Task[]>([]);
const projectFilter = ref("");
const enabledFilter = ref<"all" | "enabled" | "disabled">("all");
const query = ref("");
const page = ref(1);
const loading = ref(true);
const error = ref("");
const busyId = ref<string | null>(null);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return tasks.value.filter((task) => {
    if (projectFilter.value && task.projectId !== projectFilter.value) {
      return false;
    }
    if (enabledFilter.value === "enabled" && !task.enabled) {
      return false;
    }
    if (enabledFilter.value === "disabled" && task.enabled) {
      return false;
    }
    if (!q) {
      return true;
    }
    return (
      task.name.toLowerCase().includes(q) ||
      task.id.toLowerCase().includes(q) ||
      (task.description?.toLowerCase().includes(q) ?? false) ||
      (task.projectName?.toLowerCase().includes(q) ?? false)
    );
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));

const pageItems = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filtered.value.slice(start, start + PAGE_SIZE);
});

watch([projectFilter, enabledFilter, query], () => {
  page.value = 1;
});

watch(pageCount, (count) => {
  if (page.value > count) {
    page.value = count;
  }
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [projectList, taskList] = await Promise.all([listProjects(), listTasks()]);
    projects.value = projectList;
    tasks.value = taskList;
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

onMounted(() => {
  void load();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Tasks</h1>
        <div class="subtitle">Manifest-synced and API-created tasks across all projects</div>
      </div>
      <button class="btn btn-sm" type="button" :disabled="loading" @click="load">Refresh</button>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="inline-form mb-7 task-filters">
      <div class="field">
        <label for="project-filter">Project</label>
        <select id="project-filter" v-model="projectFilter">
          <option value="">All projects</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="enabled-filter">Enabled</label>
        <select id="enabled-filter" v-model="enabledFilter">
          <option value="all">All</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>
      <div class="field flex-2">
        <label for="task-search">Search</label>
        <input
          id="task-search"
          v-model="query"
          class="input"
          type="search"
          placeholder="Name, description, project…"
        />
      </div>
      <div class="field task-filter-count">
        <label>&nbsp;</label>
        <span class="muted">{{ filtered.length }} task{{ filtered.length === 1 ? "" : "s" }}</span>
      </div>
    </div>

    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="projects.length === 0" class="empty">Add a project first</div>
    <div v-else-if="tasks.length === 0" class="empty">No tasks yet — sync a project manifest</div>
    <div v-else-if="filtered.length === 0" class="empty">No tasks match these filters</div>
    <template v-else>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Project</th>
              <th>Enabled</th>
              <th>Agent</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in pageItems" :key="task.id">
              <td>
                <div class="entity-name">{{ task.name }}</div>
                <div class="mono muted text-sm">{{ task.id.slice(0, 10) }}…</div>
                <div v-if="task.description" class="muted text-sm">
                  {{ task.description }}
                </div>
              </td>
              <td>
                <div>{{ task.projectName || "—" }}</div>
                <div class="mono muted text-sm">{{ task.projectId.slice(0, 10) }}…</div>
              </td>
              <td>{{ task.enabled ? "yes" : "no" }}</td>
              <td>
                <div>{{ task.agentProfileName || "—" }}</div>
                <div v-if="task.agentProfileId" class="mono muted text-sm">
                  {{ task.agentProfileId.slice(0, 10) }}…
                </div>
              </td>
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

      <div v-if="pageCount > 1" class="activity-pager">
        <button class="btn btn-sm" type="button" :disabled="page <= 1" @click="page -= 1">
          Prev
        </button>
        <span class="muted">Page {{ page }} / {{ pageCount }}</span>
        <button
          class="btn btn-sm"
          type="button"
          :disabled="page >= pageCount"
          @click="page += 1"
        >
          Next
        </button>
      </div>
    </template>
  </div>
</template>
