<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";

import {
  createProject,
  deleteProject,
  getProjectDoctor,
  listProjects,
  syncProject,
} from "@/api";
import DirectoryPicker from "@/components/DirectoryPicker.vue";
import type { Project, ProjectDoctorResult } from "@/types";

const projects = ref<Project[]>([]);
const loading = ref(true);
const error = ref("");
const busyId = ref<string | null>(null);
const pickerOpen = ref(false);
const doctorResult = ref<ProjectDoctorResult | null>(null);
const doctorProjectName = ref("");

const name = ref("");
const repoPath = ref("");

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || "project";
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    projects.value = await listProjects();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load projects";
  } finally {
    loading.value = false;
  }
}

function onPicked(path: string) {
  repoPath.value = path;
  if (!name.value.trim()) {
    name.value = basename(path);
  }
  pickerOpen.value = false;
}

async function addProject() {
  if (!name.value.trim() || !repoPath.value.trim()) {
    return;
  }
  error.value = "";
  try {
    await createProject({ name: name.value.trim(), repoPath: repoPath.value.trim() });
    name.value = "";
    repoPath.value = "";
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to create project";
  }
}

async function sync(id: string) {
  busyId.value = id;
  error.value = "";
  try {
    await syncProject(id);
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Sync failed";
  } finally {
    busyId.value = null;
  }
}

async function doctor(project: Project) {
  busyId.value = project.id;
  error.value = "";
  doctorResult.value = null;
  try {
    doctorResult.value = await getProjectDoctor(project.id);
    doctorProjectName.value = project.name;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Doctor failed";
  } finally {
    busyId.value = null;
  }
}

async function remove(project: Project) {
  if (!confirm(`Remove project “${project.name}”? This does not delete the git repo.`)) {
    return;
  }
  busyId.value = project.id;
  error.value = "";
  try {
    await deleteProject(project.id);
    if (doctorResult.value?.projectId === project.id) {
      doctorResult.value = null;
    }
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Remove failed";
  } finally {
    busyId.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Projects</h1>
        <div class="subtitle">Git repositories under orchestration</div>
      </div>
      <button class="btn btn-sm" type="button" @click="load">Refresh</button>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <form class="inline-form" @submit.prevent="addProject">
      <div class="field">
        <label for="name">Name</label>
        <input id="name" v-model="name" placeholder="my-service" required />
      </div>
      <div class="field path-field">
        <label for="repo">Repo path</label>
        <div class="path-input-row">
          <input
            id="repo"
            v-model="repoPath"
            class="mono"
            placeholder="Browse to a git repository…"
            readonly
            required
            @click="pickerOpen = true"
          />
          <button class="btn" type="button" @click="pickerOpen = true">Browse…</button>
        </div>
      </div>
      <button class="btn btn-primary" type="submit" :disabled="!repoPath">Add project</button>
    </form>

    <DirectoryPicker
      :open="pickerOpen"
      :initial-path="repoPath || undefined"
      @close="pickerOpen = false"
      @select="onPicked"
    />

    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="projects.length === 0" class="empty">No projects registered</div>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Repo path</th>
            <th>Branch</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="project in projects" :key="project.id">
            <td>
              <RouterLink :to="`/projects#${project.id}`">{{ project.name }}</RouterLink>
            </td>
            <td class="mono muted">{{ project.repoPath }}</td>
            <td class="mono">{{ project.defaultBranch }}</td>
            <td class="mono muted">{{ new Date(project.updatedAt).toLocaleString() }}</td>
            <td>
              <RouterLink :to="`/projects#${project.id}`" class="btn btn-sm">Inspect</RouterLink>
              <button
                class="btn btn-sm"
                type="button"
                :disabled="busyId === project.id"
                @click="sync(project.id)"
              >
                Sync
              </button>
              <button
                class="btn btn-sm"
                type="button"
                :disabled="busyId === project.id"
                @click="doctor(project)"
              >
                Doctor
              </button>
              <button
                class="btn btn-sm btn-danger"
                type="button"
                :disabled="busyId === project.id"
                @click="remove(project)"
              >
                Remove
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-if="doctorResult" class="panel mt-7">
      <div class="panel-header">Doctor — {{ doctorProjectName }}</div>
      <div class="panel-body mono">
        <div>
          repoExists=
          <span :class="doctorResult.repoExists ? 'ok' : 'bad'">{{
            doctorResult.repoExists
          }}</span>
        </div>
        <div>
          manifest=
          <span :class="doctorResult.manifest ? 'ok' : 'bad'">{{ doctorResult.manifest }}</span>
        </div>
        <div class="muted mt-3">projectId={{ doctorResult.projectId }}</div>
      </div>
    </section>

    <section v-if="projects.length" id="inspect" class="panel mt-7">
      <div class="panel-header">Inspect</div>
      <div class="panel-body">
        <p class="muted">Select a project row or use the hash anchor to view manifest JSON.</p>
        <details v-for="project in projects" :key="project.id" :id="project.id">
          <summary class="mono">{{ project.name }} — {{ project.id.slice(0, 12) }}…</summary>
          <pre class="pre-block">{{ project.manifestJson || "{}" }}</pre>
        </details>
      </div>
    </section>
  </div>
</template>
