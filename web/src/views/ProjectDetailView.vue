<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import {
  deleteProject,
  getProject,
  getProjectDoctor,
  syncProject,
} from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { computeProjectHealth, parseManifestView } from "@/lib/project-manifest";
import type { Project, ProjectDoctorResult, ProjectSyncResult } from "@/types";

const route = useRoute();
const router = useRouter();

const project = ref<Project | null>(null);
const doctor = ref<ProjectDoctorResult | null>(null);
const lastSync = ref<ProjectSyncResult | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const removeOpen = ref(false);

const projectId = computed(() => route.params.id as string);

const manifest = computed(() => parseManifestView(project.value?.manifestJson));

const health = computed(() =>
  project.value
    ? computeProjectHealth(project.value, doctor.value)
    : { score: null, level: "missing" as const, label: "…" },
);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    project.value = await getProject(projectId.value);
    doctor.value = await getProjectDoctor(projectId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load project";
    project.value = null;
    doctor.value = null;
  } finally {
    loading.value = false;
  }
}

async function runSync() {
  if (!project.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await syncProject(project.value.id);
    project.value = result.project;
    lastSync.value = result.sync;
    const path = result.sync.manifestPath
      ? result.sync.manifestPath.split(/[/\\]/).slice(-2).join("/")
      : "no manifest file";
    notice.value = `Synced from ${path} — ${result.sync.agentProfiles} agents, ${result.sync.tasks} tasks, ${result.sync.schedules} schedules`;
    doctor.value = await getProjectDoctor(project.value.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Sync failed";
  } finally {
    busy.value = false;
  }
}

async function confirmRemove() {
  if (!project.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await deleteProject(project.value.id);
    removeOpen.value = false;
    await router.push({ name: "projects" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Remove failed";
    busy.value = false;
  }
}

watch(projectId, () => {
  lastSync.value = null;
  notice.value = "";
  void load();
});

onMounted(() => {
  void load();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <RouterLink :to="{ name: 'projects' }" class="muted text-sm">← Projects</RouterLink>
        <h1 class="mt-2">{{ project?.name ?? "Project" }}</h1>
        <div v-if="project" class="subtitle mono">{{ project.id }}</div>
      </div>
      <div class="toolbar">
        <button class="btn btn-sm" type="button" :disabled="busy || loading" @click="load()">
          Refresh
        </button>
        <button
          class="btn btn-sm btn-primary"
          type="button"
          :disabled="busy || !project"
          @click="runSync()"
        >
          Sync
        </button>
        <button
          class="btn btn-sm btn-danger"
          type="button"
          :disabled="busy || !project"
          @click="removeOpen = true"
        >
          Remove
        </button>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="notice" class="alert alert-success">{{ notice }}</div>

    <div v-if="loading && !project" class="empty">Loading…</div>
    <template v-else-if="project">
      <section class="panel mb-7">
        <div class="panel-header">
          Overview
          <span
            class="badge"
            :class="{
              'badge-success': health.level === 'ok',
              'badge-warn': health.level === 'warn',
              'badge-neutral': health.level === 'missing',
            }"
            >{{ health.label }}</span
          >
        </div>
        <div class="panel-body">
          <dl class="project-meta">
            <div>
              <dt>Repository</dt>
              <dd class="mono">{{ project.repoPath }}</dd>
            </div>
            <div>
              <dt>Default branch</dt>
              <dd class="mono">{{ project.defaultBranch }}</dd>
            </div>
            <div>
              <dt>Configured</dt>
              <dd>
                {{ project.enabledTaskCount }}/{{ project.taskCount }} tasks ·
                {{ project.enabledScheduleCount }}/{{ project.scheduleCount }} schedules
              </dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd class="mono">{{ new Date(project.updatedAt).toLocaleString() }}</dd>
            </div>
          </dl>

          <div class="toolbar mt-5">
            <RouterLink
              class="btn btn-sm"
              :to="{ name: 'tasks', query: { projectId: project.id } }"
              >Tasks</RouterLink
            >
            <RouterLink
              class="btn btn-sm"
              :to="{ name: 'schedules', query: { projectId: project.id } }"
              >Schedules</RouterLink
            >
            <RouterLink
              class="btn btn-sm"
              :to="{ name: 'runs', query: { projectId: project.id } }"
              >Runs</RouterLink
            >
          </div>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Sync</div>
        <div class="panel-body">
          <p class="muted">
            Sync reads <span class="mono">gojo.yaml</span> (or
            <span class="mono">.gojo/project.yaml</span>) and upserts agents, tasks, and schedules
            by name. Entries removed from the manifest are soft-disabled so they stop firing.
            Sync does not change git history or your working tree.
          </p>
          <div v-if="lastSync" class="mt-5 project-sync-result">
            <div>
              Manifest:
              <span class="mono">{{ lastSync.manifestPath ?? "not found" }}</span>
            </div>
            <div class="muted mt-2">
              {{ lastSync.agentProfiles }} agents · {{ lastSync.tasks }} tasks ·
              {{ lastSync.schedules }} schedules
            </div>
          </div>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Health</div>
        <div class="panel-body">
          <div v-if="!doctor" class="muted">Doctor results unavailable.</div>
          <ul v-else class="health-checklist">
            <li>
              <span :class="doctor.repoExists ? 'ok' : 'bad'">●</span>
              Repository path {{ doctor.repoExists ? "exists" : "is missing" }}
            </li>
            <li>
              <span :class="doctor.manifest ? 'ok' : 'bad'">●</span>
              Manifest file {{ doctor.manifest ? "found" : "not found" }}
            </li>
            <li>
              <span :class="doctor.baseCheckout.clean ? 'ok' : 'bad'">●</span>
              Base checkout
              {{ doctor.baseCheckout.clean ? "is clean" : "has local changes" }}
              <span v-if="doctor.baseCheckout.behindOrigin != null" class="muted">
                · {{ doctor.baseCheckout.behindOrigin }} commit(s) behind origin
              </span>
              <ul
                v-if="doctor.baseCheckout.dirtyFiles.length"
                class="muted mt-2 health-dirty-files"
              >
                <li
                  v-for="file in doctor.baseCheckout.dirtyFiles.slice(0, 12)"
                  :key="file"
                  class="mono"
                >
                  {{ file }}
                </li>
                <li v-if="doctor.baseCheckout.dirtyFiles.length > 12">
                  … +{{ doctor.baseCheckout.dirtyFiles.length - 12 }} more
                </li>
              </ul>
            </li>
            <li v-for="tool in doctor.validationTools" :key="`${tool.task}:${tool.step}:${tool.binary}`">
              <span :class="tool.found ? 'ok' : 'bad'">●</span>
              Validation tool <span class="mono">{{ tool.binary }}</span>
              <template v-if="tool.shellBuiltin"> (shell builtin — ok)</template>
              <template v-else-if="tool.found"> found on daemon PATH</template>
              <template v-else> missing under daemon PATH</template>
              <span class="muted"> — {{ tool.task }} / {{ tool.step }}</span>
            </li>
            <li v-if="doctor.validationTools.length === 0" class="muted">
              No validation tool checks reported
            </li>
          </ul>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Configuration</div>
        <div class="panel-body">
          <div v-if="!project.hasManifest" class="muted">
            No synced manifest yet. Run Sync after adding a
            <span class="mono">gojo.yaml</span>.
          </div>
          <template v-else-if="!manifest.ok">
            <div class="alert alert-error">Could not parse manifest: {{ manifest.error }}</div>
          </template>
          <template v-else>
            <div v-if="Object.keys(manifest.repository).length" class="mb-7">
              <div class="panel-subheader">Repository</div>
              <ul class="project-kv">
                <li v-for="(value, key) in manifest.repository" :key="key">
                  <span class="mono">{{ key }}</span>
                  <span class="muted">{{ String(value) }}</span>
                </li>
              </ul>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Agents ({{ manifest.agents.length }})</div>
              <div v-if="manifest.agents.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Adapter</th>
                      <th>Model</th>
                      <th>Timeout</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="agent in manifest.agents" :key="agent.name">
                      <td class="entity-name">{{ agent.name }}</td>
                      <td class="mono">{{ agent.adapter }}</td>
                      <td class="mono muted">{{ agent.model ?? "—" }}</td>
                      <td class="mono muted">{{ agent.timeout ?? "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Tasks ({{ manifest.tasks.length }})</div>
              <div v-if="manifest.tasks.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Agent</th>
                      <th>Integration</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="task in manifest.tasks" :key="task.name">
                      <td class="entity-name">{{ task.name }}</td>
                      <td class="mono">{{ task.agent }}</td>
                      <td class="mono">{{ task.integrationMode }}</td>
                      <td class="muted">{{ task.description || "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Schedules ({{ manifest.schedules.length }})</div>
              <div v-if="manifest.schedules.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Task</th>
                      <th>Cron</th>
                      <th>Timezone</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="schedule in manifest.schedules" :key="schedule.name">
                      <td class="entity-name">{{ schedule.name }}</td>
                      <td class="mono">{{ schedule.task }}</td>
                      <td class="mono">{{ schedule.cron }}</td>
                      <td class="mono muted">{{ schedule.timezone }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">
                Validation profiles ({{ manifest.validationProfiles.length }})
              </div>
              <div v-if="manifest.validationProfiles.length === 0" class="muted">None</div>
              <ul v-else class="project-kv">
                <li v-for="profile in manifest.validationProfiles" :key="profile.name">
                  <span class="mono">{{ profile.name }}</span>
                  <span class="muted">{{ profile.stepCount }} steps</span>
                </li>
              </ul>
            </div>

            <details class="project-raw-json">
              <summary class="muted">Advanced: raw JSON</summary>
              <pre class="pre-block">{{ manifest.prettyJson }}</pre>
            </details>
          </template>
        </div>
      </section>
    </template>

    <ConfirmDialog
      :open="removeOpen"
      title="Remove project?"
      confirm-label="Remove project"
      danger
      @close="removeOpen = false"
      @confirm="confirmRemove"
    >
      <p>
        Unregister <strong>{{ project?.name }}</strong> from gojo. Scheduled work for this project
        stops, and gojo’s local history for it is removed.
      </p>
      <p class="muted mt-3">
        This does <strong>not</strong> delete the git repository at
        <span class="mono">{{ project?.repoPath }}</span>.
      </p>
    </ConfirmDialog>
  </div>
</template>
